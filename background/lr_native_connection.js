/*
   Copyright (C) 2020-2021 Max Nikulin

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

class LrNativeConnectionDisconnected {
	async send(_method, _params) {
		throw new Error("LrNativeConnection has been disconnected");
	};
	disconnect() {
		// nothing to do
	};
}

class LrNativeConnectionActive {
	constructor(backend, proxy) {
		if (!("connectNative" in bapi.runtime)) {
			throw new Error("No permission for native apps");
		}
		this.port = bapi.runtime.connectNative(backend);
		this.proxy = proxy;
		this.promiseMap = new Map();
		this.onDisconnect = this.doOnDisconnect.bind(this);
		this.port.onDisconnect.addListener(this.onDisconnect);
		this.onMessage = this.doOnMessage.bind(this);
		this.port.onMessage.addListener(this.onMessage);
	};

	/** `params` is wrapped into array
	 * to keep compatibility with JSON-RPC 1.0 as it is implemented by builtin
	 * Go "net/rpc/jsonrpc" package.
	 */
	async send(method, params) {
		const response = await this.doSend({
			jsonrpc: "2.0",
			id: LrNativeConnectionActive.getId(),
			method: method,
			params: [ params ],
		});
		const error = response && response.error;
		if (error) {
			if (typeof error === "string") {
				throw new Error("Backend error: " + error);
			}
			throw new Error("Backend error: " + JSON.stringify(error));
		} else if (response && typeof response.result !== 'undefined') {
			// Go "net/rpc/jsonrpc" sends "response.result = null"
			return response.result;
		}
		throw new Error("JSON-RPC error: invalid response");
	};

	disconnect(error = null) {
		if (this.port == null) {
			console.error("LrNativeConnectionActive: port already disconnected");
		} else {
			this.port.onDisconnect.removeListener(this.onDisconnect);
			this.port.onMessage.removeListener(this.onMessage);
			this.port.disconnect();
			this.port = null;
		}

		if (this.proxy != null) {
			this.proxy._disconnect()
			this.proxy = null;
		}

		if (this.promiseMap.size >= 0) {
			if (error == null) {
				error = "Port has been closed unexpectedly. Browser console might provide details";
			}
			for (const [id, value] of this.promiseMap.entries()) {
				const reason = value.error || new Error();
				reason.message = "" + error;
				value.reject(reason);
			}
			this.promiseMap.clear();
		}
	};

	async doSend(message) {
		const id = message.id;
		console.assert(!this.promiseMap.has(id), "request id should not be in the map");
		this.port.postMessage(message);
		const entry = { error: Error() };
		const promise = new Promise((resolve, reject) => {
			entry.resolve = resolve;
			entry.reject = reject;
		});
		this.promiseMap.set(id, entry);
		return promise;
	};

	doOnMessage(message, port) {
		const id = message && message.id;
		if (id == null) {
			if (message.error) {
				console.error("LR: native messaging: error with no id: %o: closing connection. %o %o",
					message.error, port, message);
				this.disconnect(message.error);
				return;
			} else {
				console.error("LR: native messaging: Invalid message received %o %o", port, message);
				throw new Error("Invalid native message");
			}
		}
		const promise = this.promiseMap.get(id);
		if (promise == null) {
			console.error("Message with unknown id received", port, message);
			throw new Error("Native message with invalid id");
		}
		promise.resolve(message);
		this.promiseMap.delete(id);
	};

	doOnDisconnect() {
		this.disconnect((this.port && this.port.error) ||
			(bapi.runtime.lastError && bapi.runtime.lastError.message));
	};
}

LrNativeConnectionActive.lastId = 0;
LrNativeConnectionActive.getId = function() { return ++this.lastId; }

class LrNativeConnection {
	constructor(backend) {
		this._state = new LrNativeConnectionActive(backend, this);
	};
	async send(method, params) {
		return this._state.send(method, params);
	};
	disconnect(error) {
		return this._state.disconnect(error);
	};
	_disconnect() {
		this._state = new LrNativeConnectionDisconnected();
	};
}

class LrAbortableNativeConnection extends LrNativeConnection {
	/**
	 * TODO In addition to `abortPromise`, support fallback to
	 * `signal` (`AbortSignal`) field of the object `lockPromise` is resolved to.
	 */
	constructor(backend, lockPromise) {
		super(backend);
		this._lock = lockPromise;
	}

	withTimeout(timeout) {
		return Object.create(this, { _timeout: {
			value: timeout,
			enumerable: true,
			writable: false,
		} });
	}

	async send(method, params) {
		const promises = [
			super.send(method, params),
			this._getAbortPromise(),
		];
		let timeoutId;
		if (this._timeout >= 0) {
			promises.push(new Promise((_, reject) => timeoutId = setTimeout(() => {
				this.disconnect();
				reject(new Error("Timeout"));
				timeoutId = undefined;
			}, this._timeout)));
		}
		const retval = Promise.race(promises);
		if (timeoutId !== undefined) {
			function cancelTimeout() {
				if (timeoutId !== undefined) {
					clearTimeout(timeoutId);
				}
			}
			retval.then(cancelTimeout, cancelTimeout);
		}
		return retval;
	}

	async _getAbortPromise() {
		if (this._abortPromise === undefined) {
			try {
				const lock = await this._lock;
				if (lock != null) {
					this._abortPromise = lock.abortPromise.catch(ex => {
						this.disconnect(); throw ex;
					});
				}
			} catch (ex) {
				if (
					typeof lr_actionlock !== undefined
					&& ex instanceof lr_actionlock.LrActionLockCancelledError
				) {
					throw ex;
				}
				console.error("LrAbortableNativeConnection: %o", ex);
			}
		}
		if (this._abortPromise === undefined) {
			console.warn("LrAbortableNativeConnection.send: not cancellable");
			this._abortPromise = new Promise((_resilve, _reject) => /* never */ undefined);
		}
		return this._abortPromise;
	}
}
