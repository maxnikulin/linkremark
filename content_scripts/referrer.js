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
 *     { error: [ { message, name, ... } ] }
 *
 * or
 *
 *     { result: {
 *		referrer: document.referrer,
 *		opener: window.opener,
 *		activeElementNode: document.activeElement nodeName,
 *		activeElementHref: document.activeElement href or src,
 *		isTop: window.top === window,
 *		top: window.top.location,
 *		parent: window.parent.location
 *		focus: document.hasFocus()
 *		focusedElements: node names of ":focus" elements
 *     } }
 *
 * `SecurityError` exceptions while trying to get top or parent location
 * are silently ignored.
 */

"use strict";

(function lrReferrer() {

	/** Error instances could not pass through `sendMessage()` to backend */
	function lrToObject(obj) {
		if (obj instanceof Error) {
			console.error(obj);
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
			for (let prop of ["code", "stack", "fileName", "lineNumber"]) {
				if (obj[prop] != null) {
					// Make `stack` readable in `JSON.stringify()` dump.
					error[prop] = ("" + obj[prop]).split("\n");
				}
			}
			return error;
		} else {
			return obj;
		}
	}

	const warnings = [];
	const response = { warnings };
	try {
		function lrIgnore(func) {
			try {
				return func();
			} catch (ex) {
				warnings.push(lrToObject(ex));
			}
		}
		function lrIgnoreSecurityError(func) {
			try {
				return func();
			} catch (ex) {
				if (ex.name === "SecurityError") {
					return;
				}
				warnings.push(lrToObject(ex));
			}
		}

		const result = {};

		lrIgnore(function lrDocumentReferrer() {
			if (window.document.referrer) {
				result.referrer = "" + window.document.referrer;
			}
		});
		lrIgnore(function lrWindowOpener() {
			if (window.opener) {
				result.opener = "" + window.opener.location;
			}
		});
		lrIgnore(function lrActiveElement() {
			// Chrome-87: PDF file is represented as <embed> element,
			// that is actually some nested tab.
			// clickData.frameId == 0, tab.id == -1 in context menu handler,
			// so actual tab is unknown.
			// All frames in active tab reports no focus,
			// try to restore frame chain using activeElement.
			const activeElement = window.document.activeElement;
			if (activeElement) {
				result.activeElementNode = "" + activeElement.nodeName;
				if (activeElement.href) {
					result.activeElementHref = "" + activeElement.href;
				} else if (activeElement.src) {
					result.activeElementHref = "" + activeElement.src;
				}
			}
		});

		lrIgnoreSecurityError(function lrIsTopWindow() {
			let top = window.top;
			if (top) {
				result.isTop = (top === window);
				if (!result.isTop) {
					result.top = "" + top.location;
				}
			}
		});

		lrIgnoreSecurityError(function lrWindowParent() {
			var parent = window.parent;
			if (parent && parent !== window) {
				result.parent = "" + parent.location;
			}
		});

		lrIgnore(function lrHasFocus() {
			// Allow to pick proper <iframe> where text is selected
			result.hasFocus = window.document.hasFocus();
		});

		lrIgnore(function lrFocusedElement() {
			const focus = document.querySelectorAll(":focus");
			if (focus && focus.length > 0) {
				result.focusedElements = [...focus].map(x => x.nodeName);
			}
		});

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
