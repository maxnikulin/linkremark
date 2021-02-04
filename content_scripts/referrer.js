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

/* Tries to obtain relations of current frame
 *
 * Returns
 *
 *     { error: { message, name, ... } }
 *
 * or
 *
 *     { result: [ ... ], warnings: [ ... ] }
 *
 * where result elements are objects { value, key, error }
 * when the value is available.
 * error is optional error associated with particular key-value.
 * keys:
 * - "document.referrer" (location),
 * - "window.opener" (location),
 * - "document.activeElement.nodeName",
 * - "document.activeElement.href",
 * - "document.activeElement.src",
 * - "window.top" (location),
 * - "window.isTop" (`window.top === window`),
 * - "window.parent" (location),
 * - "document.hasFocus",
 * - "document.focusedElements" (`document.querySelectorAll(":focus")`),
 * - "document.lastModified"
 *
 * Warnings field is added when some exception could not be associated with
 * particular values but they are not a reason to abandon execution.
 *
 * `SecurityError` exceptions while trying to get top or parent location
 * are silently ignored or added as a string without stack or other fields.
 */

"use strict";

(function lrReferrer() {

	/** Make Error instances fields available for backend scripts */
	function lrToObject(obj) {
		console.error(obj);
		if (obj instanceof Error) {
			var error = Object.create(null);
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
		} else {
			return obj;
		}
	}

	const warnings = [];
	const response = { warnings };
	try {
		const DEFAILT_SIZE_LIMIT = 1000;

		function normalize(value, sizeLimit) {
			sizeLimit = sizeLimit || DEFAILT_SIZE_LIMIT;
			const t = typeof value;
			let error;
			if (value == null || t === "boolean" || t === "number") {
				return [ value, error ];
			}
			if (t !== "string" && value.toString === Object.prototype.toString) {
				// [object Object] is obviously useless
				throw TypeError("Not a string and has no toString");
			}
			value = "" + value;
			if (!(value.length <= sizeLimit)) {
				error = { name: "LrOverflowError", size: value.length };
				value = value.substring(0, sizeLimit);
			}
			return [ value, error ];
		}

		function lrPushProperty(array, getter, props) {
			if (props == null) {
				props = {};
			}
			const retval = { key: props.key || "unspecified." + (getter && getter.name) };
			try {
				const [ value, error ] = normalize(getter(), props.sizeLimit);
				if (value != null || props.forceNull) {
					retval.value = value;
				}
				if (error) {
					retval.error = error;
				}
				if (!props.key) {
					throw new Error("Missed property key");
				}
			} catch (ex) {
				if (ex && ex.name === "SecurityError") {
					retval.error = ex.name;
				} else {
					console.error(ex);
					retval.error = lrToObject(ex);
				}
			}
			if (retval.hasOwnProperty("value") || retval.error != null) {
				array.push(retval);
			}
		}

		function lrDocumentReferrer() {
			if (window.document.referrer) {
				return "" + window.document.referrer;
			}
		}
		function lrWindowOpener() {
			if (window.opener) {
				return "" + window.opener.location;
			}
		}
		function lrTopWindowLocation() {
			const top = window.top;
			if (top && top !== window) {
				return "" + top.location;
			}
		}
		function lrIsTopWindow() {
			try {
				return window.top === window;
			} catch (ex) {
				if (ex && ex.name === "SecurityError") {
					return false;
				}
				throw ex;
			}
		}

		function lrActiveElementNodeName() {
			// Chrome-87: PDF file is represented as <embed> element,
			// that is actually some nested tab.
			// clickData.frameId == 0, tab.id == -1 in context menu handler,
			// so actual tab is unknown.
			// All frames in active tab reports no focus,
			// try to restore frame chain using activeElement.
			const activeElement = window.document.activeElement;
			if (activeElement) {
				return "" + activeElement.nodeName;
			}
		}

		function lrActiveElementHref() {
			const activeElement = window.document.activeElement;
			if (activeElement && activeElement.href) {
				return "" + activeElement.href;
			}
		}

		function lrActiveElementSrc() {
			const activeElement = window.document.activeElement;
			if (activeElement && activeElement.src) {
				return "" + activeElement.src;
			}
		};

		function lrWindowParent() {
			var parent = window.parent;
			if (parent && parent !== window) {
				return "" + parent.location;
			}
		}

		function lrHasFocus() {
			// Allow to pick proper <iframe> where text is selected
			return window.document.hasFocus();
		}

		function lrFocusedTags() {
			const focus = document.querySelectorAll(":focus");
			if (focus && focus.length > 0) {
				return Array.from(focus, x => x.nodeName);
			}
		}

		function lrLastModified() {
			return document.lastModified;
		}

		const properties = [
			[ lrDocumentReferrer, "document.referrer" ],
			[ lrWindowOpener, "window.opener" ],
			[ lrTopWindowLocation, "window.top" ],
			[ lrIsTopWindow, "window.isTop" ],
			[ lrActiveElementNodeName, "document.activeElement.nodeName" ],
			[ lrActiveElementHref, "document.activeElement.href" ],
			[ lrActiveElementSrc, "document.activeElement.src" ],
			[ lrWindowParent, "window.parent" ],
			[ lrHasFocus, "document.hasFocus" ],
			[ lrFocusedTags, "document.focusedTags" ],
			[ lrLastModified, "document.lastModified" ],
		];

		const result = [];
		for (const item of properties) {
			try {
				const [getter, key] = item;
				lrPushProperty(result, getter, { key: key });
			} catch (ex) {
				console.error("LR: %o", item);
				warnings.push(lrToObject(ex));
			}
		}

		response.result = result;
		return response;
	} catch (ex) {
		response.error = lrToObject(ex);
		return response;
	} finally {
		if (warnings.length === 0) {
			delete response.warnings;
		}
	}
	return { error: "LR internal error: referrer.js: should not reach end of the function" };
})();
