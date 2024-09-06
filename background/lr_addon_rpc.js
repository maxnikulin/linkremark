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

class LrRpcError extends Error {
	get name() { return this.__proto__.constructor.name; };
}

class LrAddonRpc {
	constructor(initPromise) {
		this.initPromise = initPromise;
		// { callback, skipInit }
		this.methods = new Map();
		this.subscriptionHandlers = new Map();
		this.subscribed = new WeakMap();
		// `this.process` is an async function, so other `onMessage` handlers
		// could be ignored. It is intentional.
		this.listener = this.process.bind(this);
		for (const method of ["onConnectedDisconnect", "onConnect", "onConnectedMessage"]) {
			this[method] = this["_" + method].bind(this);
		}
	};
	register(name, callback, properties = null) {
		if (!callback.call) {
			throw new Error(`LrAddonRpc.register(${name}, ${callback && callback.name}): callback is not a function`);
		}
		const override = properties && properties.override != null ? properties.override : false;
		if (!override && this.methods.has(name)) {
			throw new Error(`LrAddonRpc: ${name} already registered, you could force override`);
		}
		const skipInit = !!properties?.skipInit;
		this.methods.set(name, { callback, skipInit });
	};
	process(request, port, sendResponse) {
		const id = request?.id;
		try {
			const result = this.do_process(request, port);
			// Unsure if `lr_util.isFunction` is safer here.
			if (typeof result?.then === "function") {
				result.then(this._onResult.bind(null, sendResponse, id, request))
					.catch(this._onException.bind(null, sendResponse, id, request, port));
				return true;
			}
			this._onResult(sendResponse, id, request, result);
		} catch (ex) {
			this._onException(sendResponse, id, request, port, ex);
		}
		return false;
	};

	do_process(request, port) {
		// Likely redundant check since `runtime.onExternalMessage` listener
		// should be explicitly added to receive messages from other extensions.
		if (port?.id !== chrome.runtime.id) {
			throw new LrRpcError(`Foreign message from ${String(port?.id)} rejected`);
		}
		if (request === null || typeof request !== "object") {
			throw new Error(`LrAddonRpc: bad request ${JSON.stringify(request)}`);
		}
		const { method, params, id: _id, ...unknown } = request;
		if (Object.keys(unknown).length !== 0) {
			throw new LrRpcError(`Unknown request fields: ${JSON.stringify(unknown)}`);
		}
		const callback = this.methods.get(method);
		if (!callback) {
			throw new LrRpcError(`Unknown method: ${method}`);
		}
		return callback.skipInit || this.initPromise == null
			? callback.callback(params, port)
			: this.initPromise.then(callback.callback.bind(null, params, port));
	};

	registerSubscription(name, handler) {
		const existing = this.subscriptionHandlers.get(name);
		if (existing) {
			console.warn(
				"LrAddonRpc.registerSubscription: replacing existing for %o from %o to %o",
				name, existing, handler);
		}
		this.subscriptionHandlers.set(name, handler);
	}

	_onConnect(port) {
		port.onMessage.addListener(this.onConnectedMessage);
		port.onDisconnect.addListener(this.onConnectedDisconnect);
	}

	async _onConnectedMessage(request, port) {
		const subscribed = this.subscribed.get(port);
		if (subscribed != null) {
			// Should not happen, just for the case when message arrived
			// before listener has been removed, so it is likely not delivered
			// to the subscriber.
			console.log(
				"LrAddonRpc: relaying to subscribed: %o %o %o",
				request, port, subscribed);
			subscribed.onMessage(request, port);
			return;
		}
		const { subscription } = request || {};
		if (subscription == null) {
			console.warn("LrAddonRpc: message from connection: expected subscription, got %o", request);
			return;
		}
		await this.initPromise;
		const handler = this.subscriptionHandlers.get(subscription);
		if (handler == null) {
			console.warn("LrAddonRpc: attempt to subscribe to unknown handler: %o %o", request, port);
			port.disconnect();
			return;
		}
		handler.onConnect(port);
		this.subscribed.set(port, handler);
		port.onMessage.removeListener(this.onConnectedMessage);
	}

	_onConnectedDisconnect(port) {
		if (!this.subscribed.has(port)) {
			console.warn("LrAddonRpc: connection closed before subscription: %o", port);
			port.onMessage.removeListener(this.onConnectedMessage);
			port.onDisconnect.removeListener(this.onConnectedDisconnect);
		}
		this.subscribed.delete(port);
	}

	_onResult(sendResponse, id, request, result) {
		sendResponse(result?._type === "ExecInfo" ? { id, ...result } : { id, result });
		try {
			if (result === undefined) {
				const { method, ...other } = request;
				console.error(`LrAddonRpc: undefined result for ${method}`, other);
			}
		} catch (ex) {
			Promise.reject(ex);
		}
	};

	_onException(sendResponse, id, request, port, ex) {
		console.error("LrAddonRpc: %o when processing %o %o", ex, request, port);
		sendResponse({ id, error: String(ex?.message ?? ex) });
	};
}
