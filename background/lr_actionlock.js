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
		};
		get reason() {
			return "aborted";
		};
		set reason(value) {
			Object.defineProperty(this, "reason", {
				value,
				enumerable: true,
				writable: true,
				configurable: true,
			});
			return value;
		};
		/// Firefox uses constructor definition in console messages
		/// and stack traces, so use setter.
		setReason(value) {
			this.reason = value;
			return this;
		};
	}

	this._bounceTime = Date.now();
	// `browserAction.openPopup()` is in progress.
	this._openPopupCount = 0;
	Object.defineProperty(this, "_openPopupSuppressTime", {
		value: 333,
		enumerable: true,
		configurable: true, // To be able to disable for automatic tests
	});

	/**
	 * In Firefox (78, 93) `browserAction.openPopup` fires `browserAction.onClicked`
	 * if popup is currently suppressed. Due to a nasty error in my code
	 * I accidentally got infinite loop calling `browserAction.onClicked` listener.
	 * This function is added to mitigate effect of such mistakes.
	 */
	function _popupAllowed() {
		if (!bapi.browserAction.openPopup) {
			return false;
		}
		if (lr_actionlock._openPopupCount !== 0) {
			console.warn("lr_actionlock._popupAllowed: opening popups: %o", lr_actionlock._openPopupCount);
		}
		const now = Date.now();
		if (!(now > lr_actionlock._bounceTime)) {
			console.error(
				"lr_actionlock._popupAllowed: time till debounce timeout: %o",
				lr_actionlock._bounceTime - now);
			return false;
		}
		return true;
	}

	async function _openPopup() {
		if (!lr_actionlock._popupAllowed()) {
			return;
		}
		++lr_actionlock._openPopupCount;
		try {
			lr_actionlock._bounceTime = Date.now() + lr_actionlock._openPopupSuppressTime;
			const openPromise = bapi.browserAction.openPopup();
			if (openPromise?.then === undefined) {
				// In Firefox mv2 `chrome.browserAction.openPopup`
				// unlike `browser.browserAction.openPopup` returns `undefined`
				// and does not allow to pass a callback.
				console.warn("lr_actionlock: [browser]action.openPopup error may be hidden");
			}
			return await openPromise;
		} finally {
			--lr_actionlock._openPopupCount;
			lr_actionlock._bounceTime = Date.now() + lr_actionlock._openPopupSuppressTime;
		}
	}

	/// Lock object exposed to LrExecutor
	class LrActionLock {
		constructor({ signal, readyPromise, onFinished }) {
			this.signal = signal;
			this.ready = readyPromise;
			this.finished = onFinished;
		}
	}

	/// Internal lock object for the queue.
	class LrActiveActionLock {
		constructor({ id, title, onFinished }) {
			// Force string to make "data-" (`dataset`) DOM operations more convenient.
			this.id = id != null ? id : String(lr_common.getId());
			this.title = title;
			this._abortController = new AbortController();
			this.lock = new LrActionLock({
				signal: this._abortController.signal,
				readyPromise: new Promise((resolve, reject) => {
					this._resolveReadyPromise = resolve;
					this._rejectReadyPromise = reject;
				}),
				onFinished: onFinished && onFinished.bind(null, this),
			});

		}
		/* `async` just to ignore errors */
		async abort(error) {
			error = error ?? new LrActionLockCancelledError("Aborted");
			this._abortController?.abort(error);
			this._rejectReadyPromise?.(error);
			this._destroy();
			this._abortController = undefined;
		}
		async ready() {
			this._resolveReadyPromise?.(true);
			this._destroy();
		}
		isPending() {
			return this._resolveReadyPromise !== undefined;
		}
		toString() {
			return JSON.stringify({
				id: this.id,
				aborted: this._abortController !== undefined,
				pending: this._resolveReadyPromise !== undefined,
				title: this.title,
			});
		}
		_destroy() {
			this._resolveReadyPromise = this._rejectReadyPromise = undefined;
		}
	}

	class LrActionLockQueue {
		constructor() {
			this._running = undefined;
			this._pending = undefined;
			this._subscription = undefined;
			this.onFinished = this._doOnFinished.bind(this);
		}
		set subscription(subscription) {
			if (subscription && subscription.notify && subscription.notify.call) {
				this._subscription = subscription;
			}
		}
		acquire(title, fromBrowserActionPopup) {
			try {
				if (this._pending !== undefined && this._running === undefined) {
					console.error("LrActionLockQueue.acquire: pending task with no running one");
					try {
						this._rejectPending(
							new LrActionLockCancelledError("Discarded").setReason("discarded"));
					} catch (ex) {
						console.error("LrActionLockQueue.acquire: rejecting pending: %o", ex);
					}
				}

				const id = String(lr_common.getId());
				const lock = new LrActiveActionLock({
					id,
					title,
					onFinished: this.onFinished,
				});

				let status = "unknown";
				if (this._running) {
					this._rejectPending(
						new LrActionLockCancelledError("Another action requested")
						.setReason("replaced"));
					this._pending = lock;
					status = "pending";
					try {
						if (
							!fromBrowserActionPopup && this._subscription != null
							// namely `chrome`, not `bapi` here
							&& chrome["action" in chrome ? "action" : "browserAction"].openPopup !== undefined
						) {
							if (this._subscription) {
								this._subscription.expectConnect();
							}
							/* await */ lr_actionlock._openPopup();
						}
					} catch (ex) {
						// Calling after await (out of user action scope)
						// should not break something.
						console.error("LrActionLockQueue.acquire: ignored error: %o", ex);
					}
				} else {
					this._running = lock;
					status = "running";
					bapi.browserAction.setPopup({ popup: bapi.runtime.getURL("/pages/lr_browseraction.html") })
						.catch(ex => void Promise.reject(ex)).then(() => lock.ready());
				}
				if (this._subscription != null) {
					this._subscription.notify({ id, title, status });
				}
				return lock.lock;
			} catch (ex) {
				console.error("LrActionLockQueue.acquire: ignored error: %o", ex);
			}

			// proceed without lock
			return undefined;
		}

		_doOnFinished(lock, status) {
			if (this._subscription != null) {
				this._subscription.notify({
					id: lock.id,
					title: lock.title,
					status: status || "unknown"
				});
			}
			console.assert(typeof lock.id === "string", "lock should have valid id");
			if (this._pending?.id === lock.id) {
				this._pending = undefined;
				return;
			}
			if (this._running !== undefined && this._running.id === lock.id) {
				this._running = undefined;
			}
			// Maybe called from `lr_executor` on cancelling of previoous pending.
			if (this._running !== undefined) {
				return;
			}
			if (this._pending !== undefined && !this._pending?.isPending()) {
				console.error("lr_actionlock: pending task is aborted", this._pending);
				this._pending = undefined;
			}
			const pending = this._pending;
			if (pending) {
				this._running = pending;
				this._pending = undefined;
				this._running.ready();
				if (this._subscription != null) {
					this._subscription.notify({
						id: this._running.id,
						title: this._running.title,
						status: "running"
					});
				}
			} else if (this._subscription != null) {
					/* await */ bapi.browserAction.setPopup({ popup: "" });
			}
		}

		async unlock(ids) {
			let cancelRunning = false;
			let error;
			for (const id of ids) {
				if (this._pending != null && id === this._pending.id) {
					error = error ?? new LrActionLockCancelledError("Cancelled").setReason("cancelled");
					this._rejectPending(error);
				} else if (this._running != null && id === this._running.id) {
					cancelRunning = true;
				} else {
					console.debug("LrActionLockQueue.unlock: unknown id '%o'. Already completed?", id);
				}
			}
			if (cancelRunning) {
				error = error ?? new LrActionLockCancelledError("Interrupted").setReason("interrupted");
				this._abortRunning(error);
			}
		}

		/** A reason to call this function is that popup appears instead of
		/* starting a new capture. */
		reset() {
			console.warn("lr_actionlock.queue.reset");
			const error = new LrActionLockCancelledError("Reset").setReason("reset");
			let retval = "";
			try {
				/* await */ bapi.browserAction.setPopup({ popup: "" });
			} catch (ex) {
				retval = "Failed to disable popup";
				console.error("LrActionLockQueue.reset: disable popup: %o", ex);
			}
			try {
				this._rejectPending(error);
			} catch (ex) {
				retval = "Failed to cancel pending capture";
				console.error("LrActionLockQueue.reset: cancel pending: %o", ex);
			}
			this._pending = undefined;
			try {
				this._abortRunning(error);
			} catch (ex) {
				retval = "Failed to abort active capture";
				console.error("LrActionLockQueue.reset: abort running: %o", ex);
			}
			this._running = undefined;
			return retval;
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

		_rejectPending(error) {
			const pending = this._pending;
			if (pending === undefined) {
				return;
			}
			error = error ?? new LrActionLockCancelledError("Cancelled");
			pending.abort(error);
			if (this._subscription != null) {
				this._subscription.notify({
					id: pending.id,
					status: error.reason ?? "aborted"
				});
			}
		}

		_abortRunning(error) {
			const running = this._running;
			if (running === undefined) {
				return;
			}
			running.abort(error);
			if (this._subscription != null) {
				this._subscription.notify({
					id: running.id, status: error?.reason || "aborted"
				});
			}
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
		rpcServer.register("lock.reset", this.queue.reset.bind(this.queue));
		rpcServer.registerSubscription("captureStatus", subscription);
	}

	Object.assign(lr_actionlock, {
		LrActionLockCancelledError,
		queue,
		register,
		_openPopup,
		_popupAllowed,
		_internal: {
			LrActionLockQueue,
			LrActiveActionLock,
			LrActionLock,
			subscription,
		},
	});
	return lr_actionlock;
});
