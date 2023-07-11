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

var lr_common = Object.assign(lr_common || new function lr_common() {}, {
	errorToObject: /* recursive */ function lrErrorToObject(obj) {
		// Firefox-102 ESR uses JSON serialization for exceptions
		// thrown by content scripts and returned by `scripting.executeScript`
		// as `InjectionResult.error`. It is necessary to transform
		// `stack` however.
		if (obj == null) {
			return obj;
		}
		var error = {};
		if (typeof obj.message === 'string') {
			error.message = obj.message;
		} else if (obj.message != null) {
			error.message = String(obj);
		}
		if (obj.name != null) {
			error.name = String(obj.name);
		} else {
			const p = Object.getPrototypeOf(obj);
			error.name = p && p.constructor && p.constructor.name ||
				Object.prototype.toString.call(obj);
		}
		const { stack } = obj;
		if (typeof stack === "string" && stack !== "") {
			// Make `stack` readable in `JSON.stringify()` dump.
			const lines = stack.trim().split("\n");
			error.stack = lines.length > 1 ? lines : stack;
		}
		for (let prop of ["code", "fileName", "lineNumber", "columnNumber"]) {
			const value = obj[prop];
			if (value == null) {
				continue;
			}
			const type = typeof value;
			if (type === "string" || type === "number") {
				error[prop] = value;
			}
		}
		const cause = obj.cause;
		if (cause != null) {
			try {
				error.cause = lrErrorToObject(cause);
			} catch {
				console.error("lrErrorToObject: cause error: %o", ex);
				children.push(String(cause));
			}
		}
		const aggregate = obj.errors;
		if (aggregate && Symbol.iterator in aggregate) {
			const children = [];
			try {
				for (const a of aggregate) {
					try {
						children.push(lrErrorToObject(a));
					} catch (ex) {
						console.error("lrErrorToObject: aggregate error: %o", ex);
						children.push(String(a));
					}
				}
			} catch (ex) {
				console.error("lrErrorToObject: aggregate error: %o", ex);
			}
			if (children.length > 0) {
				error.errors = children
			}
		}
		return error;
	},
	objectToError: /* recursive */ function objectToError(obj) {
		if (obj == null) {
			return obj;
		} else if (typeof obj === "string") {
			// Fallback error serialization.
			return new Error(obj);
		}
		const retval = Array.isArray(obj.errors) ? new AggregateError([]) : new Error();
		for (const field of ["message", "name", "stack", "code", "fileName", "lineNumber", "columnNumber"]) {
			if (field in obj) {
				retval[field] = obj[field];
			}
		}
		if ("cause" in obj) {
			retval.cause = objectToError(obj.cause);
		}
		if ("errors" in obj) {
			const { errors } = obj;
			if (Array.isArray(errors)) {
				retval.errors = errors.map(objectToError);
			} else {
				console.warn("lr_common.objectToError: errors is not an Array", errors);
				retval.errors = errors;
			}
		}
		return retval;
	},
	isWarning(obj) {
		return obj != null && String(obj.name).endsWith("Warning");
	},
	isGecko() {
		// Chromium-104 reports `navigator.product === "Gecko"`,
		// `userAgent` and `appVersion` are likely unreliable as well.
		// As of Firefox-105, it does not support service worker as background
		// page to test	`Boolean(window.InstallTrigger)`.
		return chrome.runtime.getURL("/").startsWith("moz-extension:/");
	},
	copyUsingEvent(text) {
		// Copy event interceptors are not expected on the add-on page,
		// so `status` is just additional check that the listener has
		// no errors in its code or user does do something like
		// disabling `dom.allow_cut_copy` on `about:config` page.
		let status = false;
		let cause;
		function lr_oncopy(event) {
			try {
				document.removeEventListener("copy", lr_oncopy, true);
				event.stopImmediatePropagation();
				event.preventDefault();
				event.clipboardData.clearData();
				event.clipboardData.setData("text/plain", text || "");
				status = true;
			} catch (ex) {
				cause = ex;
				console.error("lr_common.copyUsingEvent: error: %o", ex);
			}
		}
		window.addEventListener("copy", lr_oncopy, true);
		try {
			if (!document.execCommand("copy") || !status) {
				throw new LrError("Copy using command and event failed", { cause });
			}
			if (cause !== undefined) {
				console.error("lr_common.copyUsingEvent: success despite exception");
			}
			return true;
		} finally {
			window.removeEventListener("copy", lr_oncopy, true);
		}
	},
	getId: function(init) { return () => init++; } (Date.now()),
	/**
	 * runtime.sendMessage wrapper for communication similar to JSON-RPC
	 *
	 * Actually it is simplified version of protocol.
	 * Successful response have the `result` field.
	 * Otherwise promise is rejected either using `error` field
	 * or just stating that `onMessage` handler does not follow conventions.
	 *
	 * TODO: Target: offscreen, background, settings.
	 */
	async sendMessage(method, params) {
		const id = lr_common.getId();
		const response = await bapi.runtime.sendMessage({ id, method, params });
		if (response != null) {
			if (id !== response.id) {
				console.warn(
					"lr_common.sendMessage: response.id %o != %o", responde.id, id);
			}
			if (response._type === "ExecInfo") {
				return response;
			} else if ("result" in response) {
				return response.result;
			} else if ("error" in response) {
				const { error } = response;
				if (typeof error === "string") {
					throw new Error(error);
				}
				throw lr_common.objectToError(error);
			}
		}
		console.error("lr_common.sendMessage: invalid response", response);
		throw new Error ("Invalid response object");
	},
});

class LrError extends Error {
	get name() {
		// Minified class names would cause an issue.
		return this.constructor.name || "Error";
	};
	set name(value) {
		Object.defineProperty(this, "name", {
			value,
			configurable: true,
			writable: true,
			enumerable: true,
		});
		return value;
	};
}

class LrWarning extends LrError {
}

class LrAggregateError extends AggregateError {
	toWarning() {
		Object.setPrototypeOf(this, LrAggregateWarning.prototype);
	}
}

class LrAggregateWarning extends LrWarning {
	constructor(errors, message) {
		super(message);
		this.errors = errors;
	}
}

class LrTmpAggregateError extends LrAggregateError {
	isWarning() {
		return this.errors && this.errors.some && this.errors.every(lr_common.isWarning);
	}
	get name() {
		const warn = this.isWarning();
		return (warn ? LrAggregateWarning : LrAggregateError).name;
	}
	fix() {
		const constructor = this.isWarning() ? LrAggregateWarning : LrAggregateError;
		return Object.setPrototypeOf(this, constructor.prototype);
	}
}
