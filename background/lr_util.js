/*
   Copyright (C) 2020 Max Nikulin

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

var lr_util = function() {
	function toString(obj) {
		return Object.prototype.toString.call(obj);
	}

	function isDate(obj) {
		return toString(obj) === '[object Date]';
	}

	// In both cases typeof func === "function"
	this.isFunction = function(func) {
		return Object.prototype.toString.call(func) === '[object Function]';
	};
	this.isAsyncFunction = function(func) {
		return Object.prototype.toString.call(func) === '[object AsyncFunction]';
	};

	this.assertFunction = function(func, message = null) {
		if (!this.isFunction(func)) {
			throw new Error(message || 'Not a function');
		}
	};
	this.assertAsyncFunction = function(func, message = null) {
		if (!this.isAsyncFunction(func)) {
			throw new Error(message || 'Not a function');
		}
	};

	this.isGeneratorFunction = function(func) {
		return Object.prototype.toString.call(func) === '[object GeneratorFunction]';
	};

	this.errorToObject = function(obj) {
		var error = {};
		if (obj.message != null) {
			error.message = obj.message;
		} else {
			error.message = "" + obj;
		}
		if (obj.name != null) {
			error.name = "" + obj.name;
		} else {
			error.name = Object.prototype.toString.call(obj);
		}
		for (let prop of ["code", "stack", "fileName", "lineNumber", "columnNumber"]) {
			const value = obj[prop];
			if (value == null) {
				continue;
			}
			if (typeof value !== "string") {
				error[prop] = value;
				continue;
			}
			// Make `stack` readable in `JSON.stringify()` dump.
			const lines = value.split("\n");
			error[prop] = lines.length > 1 ? lines : value;
		}
		return error;
	};

	this.setFuncName = function(func, name) {
		if (name) {
			Object.defineProperty(func, "name", { value: name, configurable: true });
		}
		return func;
	}

	this.notFatal = function(func, name) {
		if (!name) {
			name = func.name;
		}
		const wrapper = function(...args) {
			try {
				return func(...args);
			} catch (ex) {
				console.error("lrNotFatal: " + ( name || "anonymous" ), ex);
			}
		}
		this.setFuncName(wrapper, name);
		return wrapper;
	};

	this.has = function(obj, property) {
		return obj != null && Object.prototype.hasOwnProperty.call(obj, property);
	};

	this.namespace = function(name, default_object, func) {
		if (default_object != null) {
			return func.call(default_object);
		}
		const obj = new (this.setFuncName(function() {}, name))();
		return func.call(obj);
	};

	var platformInfo = {};
	/* lr_util is too basic for initAsync function */
	var platformInfoPromise = bapi.runtime.getPlatformInfo().then(value => platformInfo = value);

	/*
	 * It is better to avoid control characters since they
	 * could be accidentally pasted into terminal without proper protection.
	 * https://flask.palletsprojects.com/en/1.1.x/security/#copy-paste-to-terminal
	 * Copy/Paste to Terminal (in Security Considerations)
	 * https://security.stackexchange.com/questions/39118/how-can-i-protect-myself-from-this-kind-of-clipboard-abuse
	 * How can I protect myself from this kind of clipboard abuse?
	 */
	function replaceSpecial(text) {
		// 1. Replace TAB with 8 spaces to avoid accidental activation of completion
		//    if pasted to bash (dubious).
		// 2. Newlines \r and \n should be normalized.
		//    Hope new macs uses "\n", not "\r".
		// 3. Other control characters should be replaced.
		//    U+FFFD REPLACEMENT CHARACTER
		//    used to replace an unknown, unrecognized or unrepresentable character
		//
		// There is a small chance that platformInfo is not available yet.
		const nl = platformInfo.os !== "win" ? "\n" : "\r\n";
		return text.replace(/\t/g, '        ').
			replace(/\r\n|\r|\n/g, nl).
			replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "\uFFFD");
	}

	Object.assign(this, {
		toString, isDate,
		replaceSpecial, platformInfo, platformInfoPromise,
	});

	return this;
}.call(lr_util || new (function lr_util(){})());
