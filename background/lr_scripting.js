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

	lr_scripting._normalizeError = function _normalizeError(error) {
		if (lr_util.isError(error)) {
			if (!error.stack) {
				// TODO strip current function
				error.stack = new Error().stack;
			}
			return error;
		} else if (typeof error === "string") {
			return new Error(error);
		}
		try {
			console.warn("lr_scripting: unexpected error type", error);
			return new Error(String(error));
		} catch (ex) {
			return ex;
		}
		return new TypeError("Unsupported error");
	}

	/** Check lack of permissions for content scripts on particular page
	 * To avoid confusion with failure of invalid content script.
	 * `permissions.contains({origins: [url]})` gives false positive for PDF files and reader mode.
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
				// Do not do use it, it does not help against hanged scripts
				// when top tab page has different origin than clicked frame
				// (especially for PDF file, pages and popups of other extensions, etc).
				// Instead it causes "Reload page to use this extension" prompt
				// if "on click" is chosen for site access permissions.
				// injectImmediately: true, // Since Chrome-102
			});
		} catch (ex) {
			if (ex instanceof TypeError || ex instanceof ReferenceError) {
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
			console.warn(
				"lr_scripting.isForbidden: result is not a single element array",
				resultArray);
			return true;
		}
		const apiResult = resultArray[0];
		if (apiResult !== undefined && apiResult?.frameId !== target.frameId) {
			console.warn(
				"lr_scripting.isForbidden: target and result frameId mismatch",
				target, resultArray);
		}
		if (apiResult?.result === _lrScriptingIsAllowedContent()) {
			return false;
		}
		if (apiResult === undefined && lr_common.isGecko()) {
			// Firefox 102 (-?) ... 110 (+?) privileged page like about:debug
			// The same is for tabs.executeScript and Firefox 93 (-?) (+?)
			// `tabs.executeScript` for mv2 and e.g. Firefox-93 about: tab
			// returns `undefined` array element as well.
			return true;
		}
		const { error } = apiResult;
		if (error != null) {
			throw lr_scripting._normalizeError(error);
		}
		if (apiResult?.result === null) {
			// Chrome-111 hides exception details, it should not happen though.
			throw new Error("Unknown content script function error");
		}
		console.warn("lr_scripting.isForbidden: unexpected result", result);
		throw new Error("Unexpected script result");
	};

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
			console.warn("lr_scripting.executeScript: invalid target:", ex);
		}
		if (!lr_util.isFunction(func) && !lr_util.isAsyncFunction(func)) {
			throw new TypeError("Not a function");
		}
		let apiResultArray;
		try {
			apiResultArray = await bapi.scripting.executeScript({
				target: { tabId, frameIds: [ frameId ], allFrames: false },
				func, args,
			});
		} catch (ex) {
			if (!ex.stack) {
				// Unsure if it may happen in Chrome due to
				// https://crbug.com/1271527
				// "Propagate errors from scripting.executeScript to InjectionResult"
				// A potential issue is that Chrome adds `toString()`
				// result to stack.
				ex.stack = new Error().stack;
			}
			throw ex;
		}
		if (!Array.isArray(apiResultArray) || apiResultArray.length !== 1) {
			console.warn("lr_scripting.executeScript: unexpected result", apiResultArray);
			throw new Error("Unexpected content script result");
		}
		const frameResult = apiResultArray[0];
		if (frameResult === undefined && lr_common.isGecko()) {
			throw new Error("Frame is not accessible for content scripts");
		}
		if (frameResult == null) {
			throw new Error("Content script InjectionResult in null");
		}
		// It seems script execution is allowed, so return an object,
		// maybe with `error` field instead of throwing an exception.
		let { result: scriptResult, error: scriptError } = frameResult;
		if (scriptError == null && scriptResult === null) {
			// Chrome
			scriptError = new Error("Content script error not exposed");
		}
		if (scriptResult == null) {
			return {
				error: lr_common.errorToObject(lr_scripting._normalizeError(
					scriptError || new Error("No script result"))),
			};
		}
		let { result, error, warnings, ...retvalOther } = scriptResult;
		try {
			if (scriptError != null) {
				const errorObject = lr_common.errorToObject(lr_scripting._normalizeError(scriptError));
				if (result != null || error != null) {
					warnings = warnings || [];
					warnings.push(errorObject);
				} else {
					error = errorObject;
				}
			}
		} catch (ex) {
			console.warn("lr_scripting: ignore exception", ex);
		}

		try {
			const otherKeys = Object.keys(retvalOther);
			if (otherKeys.length != 0) {
				console.warn("lr_scripting: unexpected content script result fields", retvalOther);
				const errorObject = lr_common.errorToObject(
					new Error("Unexpected content script result fields: " + otherKeys));
				if (result != null || error != null) {
					warnings = warnings || [];
					warnings.push(errorObject);
				} else {
					error = errorObject;
				}
			}
		} catch (ex) {
			console.warn("lr_scripting: ignore exception", ex);
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
