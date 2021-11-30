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
	errorToObject(obj) {
		if (obj == null) {
			return null;
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
		for (let prop of ["code", "stack", "fileName", "lineNumber", "columnNumber"]) {
			const value = obj[prop];
			if (value == null) {
				continue;
			}
			if (typeof value !== "string") {
				// FIXME added to preserve `Number`, actually may cause problems
				// due to failure of structured clone.
				error[prop] = value;
				continue;
			}
			// Make `stack` readable in `JSON.stringify()` dump.
			const lines = value.trim().split("\n");
			error[prop] = lines.length > 1 ? lines : value;
		}
		const cause = obj.cause;
		if (cause != null) {
			try {
				error.cause = lr_common.errorToObject(cause);
			} catch {
				console.error("lr_common.errorToObject: cause error: %o", ex);
				children.push(String(cause));
			}
		}
		const aggregate = obj.errors;
		if (aggregate && Symbol.iterator in aggregate) {
			const children = [];
			try {
				for (const a of aggregate) {
					try {
						children.push(lr_common.errorToObject(a));
					} catch (ex) {
						console.error("lr_common.errorToObject: aggregate error: %o", ex);
						children.push(String(a));
					}
				}
			} catch (ex) {
				console.error("lr_common.errorToObject: aggregate error: %o", ex);
			}
			if (children.length > 0) {
				error.errors = children
			}
		}
		return error;
	},
	isWarning(obj) {
		return obj != null && String(obj.name).endsWith("Warning");
	},
	copyUsingEvent(text) {
		// Copy event interceptors are not expected on the add-on page,
		// so `status` is just additional check that the listener has
		// no errors in its code or user does do something like
		// disabling `dom.allow_cut_copy` on `about:config` page.
		let status = false;
		function lr_oncopy(event) {
			document.removeEventListener("copy", lr_oncopy, true);
			event.stopImmediatePropagation();
			event.preventDefault();
			event.clipboardData.clearData();
			event.clipboardData.setData("text/plain", text || "");
			status = true;
		}
		document.addEventListener("copy", lr_oncopy, true);
		try {
			return document.execCommand("copy") && status;
		} finally {
			document.removeEventListener("copy", lr_oncopy, true);
		}
	},
});

let LrError = Error;
if (!(new Error(undefined, { cause: true }).cause)) {
	LrError = class LrError extends Error {
		constructor(message, options) {
			super(message);
			if (options && options.cause) {
				this.cause = options.cause;
			}
		}
	}
}

class LrWarning extends LrError {
	constructor(message, options) {
		// TODO at least in Firefox-78 it leads to `fileName` and first `stack` entry
		// associated with common.
		super(message, options);
		if (options != null && options.cause && !this.cause) {
			this.cause = options.cause;
		}
	}
	get name() { return Object.getPrototypeOf(this).constructor.name; };
}

class LrAggregateError extends Error {
	constructor(errors, message) {
		super(message);
		this.errors = errors;
	}
	toWarning() {
		Object.setPrototypeOf(this, LrAggregateWarning.prototype);
	}
	get name() { return Object.getPrototypeOf(this).constructor.name; };
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
		return Object.setPrototypeOf(this, this.isWarning() ? LrAggregateWarning : LrAggregateError);
	}
}
