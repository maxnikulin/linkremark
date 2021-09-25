/*
   Copyright (C) 2021 Max Nikulin

   This program is free software: you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation; either version 3 of the License, or
   (at your option) any later version.

   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.

   You should have received a copy of the GNU General Public License
   along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

"use strict";

var lr_actionlock = lr_util.namespace(lr_actionlock, function lr_actionlock() {
	var lr_actionlock = this;

	class LrActionLockCancelledError extends Error {
		get name() {
			const proto = Object.getPrototypeOf(this);
			return (proto && proto.constructor && proto.constructor.name) ||
				"LrActionLockCancelledError";
		}
	}

	/// Lock object exposed to LrExecutor
	class LrActionLock {
		constructor({ abortSignal, abortPromise, onFinished }) {
			this.abortSignal = abortSignal;
			this.abortPromise = abortPromise;
			this.finished = onFinished;
		}
	}

	/// Internal lock object for the queue.
	class LrActiveActionLock {
		constructor({ id, title, onFinished }) {
			// Force string to make "data-" (`dataset`) DOM operations more convenient.
			this.id = id != null ? id : String(bapiGetId());
			this.title = title;
			this.onFinished = onFinished;
			this._abortController = new AbortController();
			this.lock = new LrActionLock({
				abortSignal: this._abortController.signal,
				abortPromise: new Promise((_, reject) => this._rejectAbortPromise = reject),
				onFinished,
			});

		}
		async abort() {
			this._abortController.abort();
			this._rejectAbortPromise(new LrActionLockCancelledError("Aborted"));
		}
	}

	class LrActionLockQueue {
		constructor() {
			this._running = undefined;
			this._pending = undefined;
			this._subscription = undefined;
			this.onRunningFinished = this._doOnRunningFinished.bind(this);
		}
		set subscription(subscription) {
			if (subscription && subscription.notify && subscription.notify.call) {
				this._subscription = subscription;
			}
		}
		async acquire(title, fromBrowserActionPopup) {
			try {
				console.assert(
					!this._pending || this._running,
					"There should be a running task when pending one exists");
				if (this._running) {
					if (this._pending) {
						if (this._subscription != null) {
							this._subscription.notify({ id: this._pending.id, status: "cancelled" });
						}
						this._pending.reject(new LrActionLockCancelledError("Another action requested"));
					}
					const id = String(bapiGetId());
					const retval = new Promise((resolve, reject) => this._pending = { resolve, reject, title, id });
					if (this._subscription != null) {
						this._subscription.notify({ id, title, status: "pending" });
					}
					try {
						if (
							!fromBrowserActionPopup && this._subscription != null
							// namely `chrome`, not `bapi` here
							&& chrome.browserAction.openPopup !== undefined
						) {
							if (this._subscription) {
								this._subscription.expectConnect();
							}
							// Hidden behind a flag #extension apis in Chrome
							// https://crbug.com/436489
							await bapi.browserAction.openPopup();
						}
					} catch (ex) {
						// Calling after await (out of user action scope)
						// should not break something.
						console.error("LrActionLockQueue.acquire: ignored error: %o", ex);
					}

					return retval;
				}
				this._running = new LrActiveActionLock({
					title,
					onFinished: this.onRunningFinished,
				});
				if (this._subscription != null) {
					this._subscription.notify({ id: this._running.id, title, status: "running" });
					await bapi.browserAction.setPopup({ popup: bapi.runtime.getURL("/pages/lr_browseraction.html") });
				}
				return this._running.lock;
			} catch (ex) {
				console.error("LrActionLockQueue.acquire: ignored error: %o", ex);
			}

			// proceed without lock
			return undefined;
		}

		_doOnRunningFinished(status) {
			if (this._running != null) {
				if (this._subscription != null) {
					this._subscription.notify({
						id: this._running.id,
						title: this._running.title,
						status: status || "unknown"
					});
				}
				this._running = undefined;
			} else {
				console.warn("LrActionLockQueue.onRunningFinished: no running task: %o", this._running);
			}
			const pending = this._pending;
			if (pending) {
				this._running = new LrActiveActionLock({
					title: pending.title,
					id: pending.id,
					onFinished: this.onRunningFinished,
				});
				if (this._subscription != null) {
					this._subscription.notify({
						id: this._running.id,
						title: this._running.title,
						status: "running"
					});
				}
				pending.resolve(this._running.lock);
				this._pending = undefined;
			} else if (this._subscription != null) {
					/* await */ bapi.browserAction.setPopup({ popup: "" });
			}
		}

		async unlock(ids) {
			let cancelRunning = false;
			for (const id of ids) {
				if (this._pending != null && id === this._pending.id) {
					if (this._subscription != null) {
						this._subscription.notify({ id: this._pending.id, status: "cancelled" });
					}
					this._pending.reject(new LrActionLockCancelledError("Cancelled"));
					this._pending = undefined;
				} else if (this._running != null && id === this._running.id) {
					cancelRunning = true;
				} else {
					console.debug("LrActionLockQueue.unlock: unknown id '%o'. Already completed?", id);
				}
			}
			if (cancelRunning) {
				this._running.abort();
			}
		}

		/** A reason to call this function is that popup appears instead of
		/* starting a new capture. */
		reset() {
			console.warn("lr_actionlock.queue.reset");
			try {
				/* await */ bapi.browserAction.setPopup({ popup: "" });
			} catch (ex) {
				console.error("LrActionLockQueue.reset: disable popup: %o", ex);
			}
			try {
				if (this._pending !== undefined) {
					this._pending.reject(new LrActionLockCancelledError("Cancelled"));
					this._pending = undefined;
				}
			} catch (ex) {
				console.error("LrActionLockQueue.reset: cancel pending: %o", ex);
			}
			try {
				if (this._running) {
					this._running.abort();
					this._running = undefined;
				}
			} catch (ex) {
				console.error("LrActionLockQueue.reset: cancel pending: %o", ex);
			}
		}

		status() {
			const result = [];
			if (this._running != undefined) {
				const { id, title } = this._running;
				result.push({ id, title, status: "running" });
			}
			if (this._pending !== undefined) {
				const { id, title } = this._pending;
				result.push({ id, title, status: "pending" });
			}
			return result;
		}
	}

	class LrActionLockSubscription {
		constructor(queue) {
			this.queue = queue;
			// There is no way to pass any parameter to `openPopup`,
			// so the only way to guess whether popup is called through browser action
			// or through `openPopup` it to record time of the latter call.
			this._time = undefined;
			this._ports = [];
			this.onConnect = this._doOnConnect.bind(this);
			this.onDisconnect = this._doOnDisconnect.bind(this);
			this.onMessage = this._doOnMessage.bind(this);
		}
		notify(message) {
			try {
				for (const port of this._ports) {
					port.postMessage({ method: "status", params: [ message ] });
				}
			} catch (ex) {
				console.error("LrActionLockSubscription.notify: %o", ex);
			}
		}
		// An attempt to avoid launch of another capture if the queue
		// opens a popup in response to context menu action.
		expectConnect() {
			this._time = Date.now();
		}

		_doOnConnect(port) {
			const now = Date.now();
			port.onDisconnect.addListener(this.onDisconnect);
			port.onMessage.addListener(this.onMessage);
			this._ports.push(port);
			if (this._ports.length !== 1) {
				console.warn("LrActionLockSubscription: more than one popup is connected: %o", this._ports);
			}
			const time = this._time;
			let launchCapture = true;
			if (time !== undefined) {
				this._time = undefined;
				const delta = 500;
				if (time < now && now - delta < time) {
					launchCapture = false;
				} else {
					console.warn("LrActionLockSubscription: ignoring saved time %o %o", time, now - time);
				}
			}

			try {
				port.postMessage({ method: "status", params: this.queue.status() });
			} catch (ex) {
				console.error("LrActionLockSubscription.onConnect: send status: %o", ex);
				port.postMessage({ method: "error", params: [ "Getting current status: " + String(ex) ]});
			}

			try {
				if (launchCapture) {
					// Do not await.
					lr_action.captureCurrentTabEndpoint();
				}
			} catch (ex) {
				console.error("LrActionLockSubscription.onConnect: capture tab: %o", ex);
				port.postMessage({ method: "error", params: [ "Lauch capture: " + String(ex) ]});
			}
		}

		_doOnDisconnect(port) {
			const index = this._ports.indexOf(port);
			port.onDisconnect.removeListener(this.onDisconnect);
			if (index >= 0) {
				this._ports.splice(index, 1);
			} else {
				console.warn("LrActionLockSubscription: unknown port to disconnect: %o %o", port, this._ports);
			}
			if (this._ports.length !== 0) {
				console.warn("LrActionLockSubscription: something remains connected: %o", this._ports);
			}
		}

		_doOnMessage(request, port) {
			try {
				const method = request && request.method;
				switch (method) {
					case "cancel":
						this.queue.unlock(request.params);
						break;
					case "launch":
						/* no await, unused, invoked through `lrSendMessage` instead of connection */
						lr_action.captureCurrentTabEndpoint();
						break;
					case "reset":
						this.queue.reset();
						break;
					default:
						console.error("LrActionLockSubscription: unsupported message: %o %o", request, port);
						port.postMessage({ method: "error", params: [ "unsupported action" ]});
				}
			} catch (ex) {
				console.error("LrActionLockSubscription.onMessage: %o", ex);
				port.postMessage({ method: "error", params: [ String(ex) ]});
			}
		}
	}

	// Perform initialization inside the module to avoid additional try-catch
	// in `main.js`. Extension should work (except locks) even if this file
	// failed to load.
	const queue = new LrActionLockQueue();
	const subscription = new LrActionLockSubscription(queue);
	queue.subscription = subscription;

	function register(rpcServer) {
		rpcServer.register("lock.reset", this.queue.reset.bind(this));
		rpcServer.registerSubscription("captureStatus", subscription);
	}

	Object.assign(lr_actionlock, {
		LrActionLockCancelledError,
		queue,
		register,
		_internal: {
			LrActionLockQueue,
			LrActiveActionLock,
			LrActionLock,
			subscription,
		},
	});
	return lr_actionlock;
});