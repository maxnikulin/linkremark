/*
   Copyright (C) 2020-2022 Max Nikulin

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
	const lr_util = this;

	function toString(obj) {
		return Object.prototype.toString.call(obj);
	}

	function isDate(obj) {
		return toString(obj) === '[object Date]';
	}

	// In both cases `typeof func === "function"`
	lr_util.isFunction = function isFunction(func) {
		return toString(func) === '[object Function]';
	};
	lr_util.isAsyncFunction = function isAsyncFunction(func) {
		return toString(func) === '[object AsyncFunction]';
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

	lr_util.isPromise = function isPromise(obj) {
		const then = obj?.then;
		return then && lr_util.isFunction(then);
	};

	lr_util.isError = function isError(obj) {
		// inspired by https://github.com/ehmicky/is-error-instance/
		try {
			return obj instanceof Error;
		} catch (ex) {
			console.warn("lr_util.isError", obj, ex);
			return false;
		}
		// Instances from other frames.
		try {
			const str = lr_util.toString(obj);
			return str === "[object Error]" // custom errors
				|| str === "[object DOMException]";
		} catch (ex) {
			console.warn("lr_util.isError", obj, ex);
			return false;
		}
		return false;
	};

	this.errorToObject = lr_common.errorToObject;

	// Does not work as `debugName` for stack traces in Firefox.
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

	/// Usage:
	///     var named_obj = lr_util.namespace(named_obj, function named_obj(name_obj) {
	///           name_obj = this;
	///           /* ... */
	///     });
	this.namespace = function(default_object, func) {
		if (default_object != null) {
			return func.call(default_object);
		}
		// Chromium-90 tries hard to use in console a name of some local object.
		// Avoiding local objects and various ways to set function name do not help.
		// "Object": return func.call(new (this.setFuncName(function() {}, name))());
		// "func": return func.call(new ((() => ({[name]: function(){}}))()[name])());
		// "func": return func.call(new (this.setFuncName((() => ({[name]: function(){}}))()[name], name))());
		// "func": return func.call(Object.create({constructor: this.setFuncName((() => ({[name]: function(){}}))()[name], name)}));
		// So call function as constructor.
		return new func() || default_object;
	};

	lr_util.defineLazyGetter = function defineLazyGetter(obj, name, create) {
		const props = {
			configurable: true,
			enumerable: true,
		}
		// A trick to set computed function name for stack traces.
		// `setFuncName` works in Chromium, but not in Firefox.
		const funcName = "_lazyGetter_" + String(name);
		const get = {
			[funcName]: function (name, create) {
				const value = create();
				Object.defineProperty(this, name, {
					...props,
					writable: false,
					value,
				});
				return value;
			}
		}[funcName];
		return Object.defineProperty(obj, name, {
			...props,
			get: get.bind(obj, name, create),
		});
	};

	var platformInfo = { newline: /^win/i.test(navigator.platform) ? "\r\n" : "\n" };

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
		// 4. U+FEFF BYTE ORDER MARK that is likely trash in HTML files
		//    been a space character does not occupy any space in Emacs.
		//    Maybe there are more similar characters.
		return text.replace(/\t/g, '        ').
			replace(/\r\n|\r|\n/g, platformInfo.newline).
			replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F\uFEFF]/g, "\uFFFD");
	}

	Object.assign(this, {
		toString, isDate,
		replaceSpecial, platformInfo,
	});

	return this;
}.call(lr_util || new (function lr_util(){})());
