/*
   Copyright (C) 2022 Max Nikulin

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

var lr_scripting = lr_util.namespace(lr_scripting, function lr_scripting() {
	const lr_scripting = this;

	lr_scripting._normalizeError = function _normalizeError(error, refError) {
		try {
			if (error == null) {
				return error;
			}
			// Firefox-102 uses JSON serialization for exceptions thrown
			// by content scripts, so most of fields are unavailable.
			let isObject;
			if (
				lr_util.isError(error)
				|| (isObject = Object.getPrototypeOf(error) === Object.prototype)
			) {
				if (error.message === undefined && isObject && lr_util.has(error, "message")) {
					// Firefox-102: `Object { message: undefined }`
					// when a content script `files` is not found.
					error.message = "Undefined error, likely content script file not found";
				}
			} else if (typeof error === "string") {
				// <https://bugzilla.mozilla.org/1824896>
				// "WebExtensions scripting.executeScript(): typeof
				// InjectionResult.error === "string" when InjectionTarget.files
				// not found"
				error = new Error(error);
			} else {
				console.warn("lr_scripting: unexpected error type", error);
				error = new TypeError("Unexpected error type " + String(error));
			}

			// <https://bugzilla.mozilla.org/1825215>
			// "undefined" string as Error.fileName in exceptions
			// thrown by scripting.executeScript"
			if (!error.stack && refError?.stack) {
				for (const f of ["stack", "fileName", "lineNumber", "columnNumber"]) {
					const vErr = error[f];
					const vRef = refError[f];
					if ((vErr == null || vErr === "") && vRef != null) {
						error[f] = vRef;
					}
				}
			}
			return error;
		} catch (ex) {
			console.error("lr_scripting: failed to normalize error", error);
			return ex;
		}
	}

	// <https://bugzilla.mozilla.org/1824901>
	// "WebExtensions scripting.executeScript() returns [undefined]
	// array for about:debugging page"
	//
	// Since at least Firefox 102 till at least 110
	// it happense for privileged pages.
	// The same is for `tabs.executeScript` and e.g. Firefox 93 mv2
	// where `tabs.executeScript` returns `[undefined]`
	// for `about:` tabs.
	lr_scripting._isFirefoxPrivilegedTabResult
		= function _isFirefoxPrivilegedTabResult(injectionResult) {
			return injectionResult === undefined && lr_common.isGecko();
		};

	/** Check for lack of permissions for content scripts on particular page
	 *
	 * To avoid confusion with failure of an invalid content script.
	 *
	 * Throws an exception when something unexpected happens.
	 *
	 * `permissions.contains({origins: [url]})` is not an option.
	 * It gives false positive for PDF files and reader mode.
	 * When the `<all_urls>` permission is not granted and the add-on gets
	 * access through `activeTab`, `permissions.contains` always returns `false`.
	 * Moreover the method may throw an exception in the case of e.g. `data:`
	 * URI scheme.
	 *
	 * Checking `Error.message` for every possible text is tedious
	 * (see comments in the function body),
	 * so just try to inject a simple function.
	 */
	lr_scripting.isForbidden = async function isForbidden(target) {
		if (target == null) {
			throw new TypeError("target must be a { tabId, frameId } object");
		}
		const { tabId, frameId } = target;
		if (!(tabId >= 0)) {
			return true;
		}
		function _lrScriptingIsAllowedContent() {
			return 314;
		}
		let resultArray;
		try {
			resultArray = await bapi.scripting.executeScript({
				target: { tabId, frameIds: [ frameId ], allFrames: false, },
				func: _lrScriptingIsAllowedContent,
				// Do not use it, it does not help against hanged scripts
				// when top tab page has different origin than clicked frame
				// (especially for PDF file, pages and popups of other extensions, etc).
				// Instead it causes "Reload page to use this extension" prompt
				// if "on click" is chosen for site access permissions.
				// injectImmediately: true, // Since Chrome-102
			});
		} catch (ex) {
			if (ex instanceof TypeError || ex instanceof ReferenceError) {
				// An error in the code calling the method.
				throw ex;
			}
			// It is usually an `Error` object and checking `message`
			// is considered unreliable.
			// - "Error: Invalid tab ID: -1" (Firefox-110)
			// - "Error: Missing host permission for the tab or frames" (Firefox-110)
			//   Firefox-93: `<iframe>` empty (works in v111), `sandbox`, or `src="data:..."`,
			//   top-level about:blank, but not other about: pages that return `undefined`, see
			//   https://bugzilla.mozilla.org/1411641
			//   "1411641 - CSP 'sandbox' directive prevents content scripts from matching..."
			// - "Error: No tab with id: -1" (Chromium-111)
			// - "Error: Cannot access a chrome:// URL" (Chromium-111)
			// - "Error: Cannot access contents of the page. Extension manifest must request permission to access the respective host."
			//   (Chromium-111, about:blank)
			// - `chrome-extension:` is a special URI for Chromium as well.
			console.debug("lr_scripting.isForbidden: exception", ex);
			return true;
		}
		if (!Array.isArray(resultArray) || resultArray.length !== 1) {
			console.warn("lr_scripting.isForbidden: Array[1] expected", resultArray);
			throw new Error("Unexpected executeScript result");
		}
		const injectionResult = resultArray[0];
		if (injectionResult !== undefined && injectionResult?.frameId !== target.frameId) {
			console.warn(
				"lr_scripting.isForbidden: target and result frameId mismatch",
				target, resultArray);
		}
		if (injectionResult?.result === _lrScriptingIsAllowedContent()) {
			return false;
		}
		if (lr_scripting._isFirefoxPrivilegedTabResult(injectionResult)) {
			return true;
		}
		const { error } = injectionResult;
		if (error != null) {
			const e = lr_scripting._normalizeError(error);
			if (!lr_util.isError(e)) {
				// Plain `Object` due to JSON serialization in Firefox-102 ESR.
				throw new Error(e.message);
			}
			throw e;
		}
		if (injectionResult?.result === null) {
			// Chrome-111 hides exception details, it should not happen though.
			throw new Error("Content script error not exposed");
		}
		console.warn("lr_scripting.isForbidden: unexpected result", result);
		throw new Error("Unexpected script result");
	};

	/** Execute content script that should return a `{ result, error, warnings }` object
	 *
	 * Handle specific cases of other return values.
	 *
	 * May either return an Object `{ result, error, warnings }`
	 * or throw an exception.
	 *
	 * Chrome does not support the `InjectionResult.error` field in the case
	 * of an exception in the content script,
	 * it just returns `null` as the `InjectionResult.result` value.
	 *
	 * <https://crbug.com/1271527>
	 * "Propagate errors from scripting.executeScript to InjectionResult"
	 *
	 * In content scripts explicitly catch `Error` objects
	 * and convert them to `Object` values. Despite Firefox uses
	 * the `structuredClone` algorithm, Firefox-102 ESR can not clone
	 * any `Error` instances and Firefox-113 has an issue
	 * with the `DOMException` type.
	 *
	 * <https://bugzilla.mozilla.org/1835058>
	 * "scriting.executeScript throws when cloning DOMException"
	 *
	 * Firefox-102 uses JSON serialization for exceptions thrown by
	 * content scripts.
	 *
	 * Chrome uses JSON serialization, so caller receives empty
	 * objects instead of `Error` instances.
	 *
	 * <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities#data_cloning_algorithm>
	 * <https://crbug.com/248548>
	 * "Extension messaging uses base::Value (JSON)
	 * serialization but could use WebSerializedScriptValue (structured
	 * cloning)"
	 */
	lr_scripting.executeScript = async function executeScript(target, func, args) {
		const { tabId, frameId, ...others } = target;
		try {
			const unknown = Object.keys(others);
			if (unknown.length !== 0) {
				throw new TypeError("Unknown executeScript target fields: " + unknown);
			} else if (frameId == null) {
				throw new TypeError("Unspecified frameId");
			}
		} catch (ex) {
			Promise.reject(ex);
		}
		if (!lr_util.isFunction(func) && !lr_util.isAsyncFunction(func)) {
			throw new TypeError("Not a function");
		}
		let apiResultArray;
		try {
			if (!lr_common.isGecko() && Array.isArray(args)) {
				// https://crbug.com/1448489
				// 'Extensions: scripting.executeScript({args:[undefined]}) throws "Value is unserializable"'
				//
				// Formally `args` value must be JSON-serializable. Actually
				// Chromium-113 throws `TypeError` when the array contains `undefined`
				// elements:
				//
				//     Error in invocation of
				//     scripting.executeScript(scripting.ScriptInjection injection, optional function callback):
				//     Error at parameter 'injection': Error at property 'args': Error at index 0:
				//     Value is unserializable.
				//
				// Chrome processes arguments individually, so effect is similar to
				//
				//     JSON.parse(JSON.stringify(undefined)) // => SyntaxError
				//
				// while
				//
				//     JSON.parse(JSON.stringify([undefined])) // => [null]
				//
				// Firefox is not affected.
				args = args.map(x => x !== undefined ? x : null);
			}
		} catch (ex) {
			Promise.reject(ex);
		}
		try {
			apiResultArray = await bapi.scripting.executeScript({
				target: { tabId, frameIds: [ frameId ], allFrames: false },
				func, args,
			});
		} catch (ex) {
			throw lr_scripting._normalizeError(ex, ex?.stack || new Error());
		}
		if (!Array.isArray(apiResultArray) || apiResultArray.length !== 1) {
			console.warn("lr_scripting.executeScript: Array[1] expected", apiResultArray);
			if (!(apiResultArray.length > 0)) {
				throw new Error("Unexpected content script result");
			}
		}
		const injectionResult = apiResultArray[0];
		if (lr_scripting._isFirefoxPrivilegedTabResult(injectionResult)) {
			throw new Error("Frame is not accessible for content scripts");
		}
		if (injectionResult == null) {
			throw new Error("Content script InjectionResult in null");
		}
		if (injectionResult?.frameId !== target.frameId) {
			console.warn(
				"lr_scripting.executeScript: target and result frameId mismatch",
				target, apiResultArray);
		}
		// If `injectionResult.result` is `null` or `undefined` then
		// return `{ error }` if `injectionResult.error` is not an `Error`
		// (Firefox-102 ESR that uses JSON serialization).
		// Otherwise throw an exception.
		let { result: scriptResult, error: scriptError } = injectionResult;
		scriptError = lr_scripting._normalizeError(
			scriptError, scriptError?.stack || new Error());
		if (scriptError == null && scriptResult === null) {
			// Chrome, see above.
			scriptError = new Error("Content script error not exposed");
		}
		if (scriptResult == null) {
			if (lr_util.isError(scriptError)) {
				throw scriptError;
			}
			return { error: scriptError };
		}
		let { result, error, warnings, ...retvalOther } = scriptResult;
		try {
			if (scriptError != null) {
				const errorObject = lr_common.errorToObject(scriptError);
				if (result != null || error != null) {
					warnings = warnings || [];
					warnings.push(errorObject);
				} else {
					error = errorObject;
				}
			}
		} catch (ex) {
			Promise.reject(ex);
		}

		try {
			const otherKeys = Object.keys(retvalOther);
			if (otherKeys.length != 0) {
				console.warn("lr_scripting: unexpected content script result fields", retvalOther);
				const keysError = new TypeError(
					"Unexpected content script result fields: " + otherKeys);
				if (result != null || error != null) {
					warnings = warnings || [];
					warnings.push(lr_common.errorToObject(keysError));
				} else if (warnings != null) {
					error = lr_common.errorToObject(keysError);
				} else {
					throw keysError;
				}
			}
		} catch (ex) {
			Promise.reject(ex);
		}
		const retval = {};
		if (result != null) {
			retval.result = result;
		}
		if (error != null) {
			retval.error = error;
		}
		if (warnings != null) {
			retval.warnings = warnings;
		}
		return retval;
	};

	return lr_scripting;
});
