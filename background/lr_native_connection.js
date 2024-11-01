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
	constructor(backend, proxy, signal) {
		if (signal?.aborted) {
			throw signal.reason;
		}
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
		try {
			if (signal != null) {
				const onAbort = this._onAbort.bind(this);
				signal.addEventListener("abort", onAbort, { once: true });
				this._removeAbortListener = signal.removeEventListener.bind(
					signal, "abort", onAbort);
			}
		} catch (ex) {
			Promise.reject(ex);
		}
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
				let reason = value.error;
				try {
					if (reason) {
						if (error instanceof Error) {
							reason.cause = error;
							reason.message = error.message;
						} else {
							reason.message = String(error);
						}
					} else {
						if (error instanceof Error) {
							reason = error;
						} else {
							reason = new Error(String(error));
						}
					}
				} catch (ex) {
					Promise.reject(ex);
					reason = new Error("Disconnect native application");
				}
				value.reject(reason);
			}
			this.promiseMap.clear();
		}
		try {
			this._removeAbortListener?.();
		} catch (ex) {
			Promise.reject(ex);
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

	_onAbort(ev) {
		this.disconnect(ev?.target?.reason);
	}
}

LrNativeConnectionActive.lastId = 0;
LrNativeConnectionActive.getId = function() { return ++this.lastId; }

class LrNativeConnection {
	constructor(backend, signal) {
		this._state = new LrNativeConnectionActive(backend, this, signal);
	};
	async send(method, params) {
		return this._state.send(method, params);
	};
	disconnect(error) {
		error = error ?? new Error("Closing native connection");
		return this._state.disconnect(error);
	};
	_disconnect() {
		this._state = new LrNativeConnectionDisconnected();
	};
}
