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

(function lrc_image() {
	const DEFAILT_SIZE_LIMIT = 1000;
	const TEXT_SIZE_LIMIT = 4000;
	console.assert(TEXT_SIZE_LIMIT >= DEFAILT_SIZE_LIMIT, "text length limits should be consistent");

	function lrNormalize(value, sizeLimit) {
		sizeLimit = sizeLimit || DEFAILT_SIZE_LIMIT;
		const t = typeof value;
		if (value == null || t === "boolean" || t === "number") {
			return { value };
		}
		if (t !== "string" && value.toString === Object.prototype.toString) {
			// [object Object] is obviously useless
			throw TypeError("Not a string and has no toString");
		}
		value = "" + value;
		if (!(value.length <= sizeLimit)) {
			const error = new LrOverflowError(value.length);
			value = value.substring(0, sizeLimit);
			return { value, error }
		}
		return { value };
	}

	/** Make Error instances fields available for backend scripts */
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

	function lrRandomId() {
		return Math.floor(Math.random()*Math.pow(2, 53));
	}

	async function lrSendMessageChrome(msg) {
		const error = new Error();
		return new Promise(function(resolve, reject) {
			try {
				chrome.runtime.sendMessage(msg, function(response) {
					const lastError = chrome.runtime.lastError;
					if (lastError instanceof Error) {
						reject(lastError);
					} else if (lastError) {
						error.message = lastError.message || "lrSendMessage: empty lastError";
						reject(error);
					} else {
						resolve(response);
					}
				});
			} catch (ex) {
				reject(ex);
			}
		});
	}

	async function lrSendMessage(method, params) {
		const msg = {method, params};
		const response = await (
			typeof browser !== "undefined" ?
			browser.runtime.sendMessage(msg) : lrSendMessageChrome(msg)
		);
		if (response != null && response.result !== undefined) {
			return response.result;
		} else if (response != null && response.error) {
			throw response.error;
		}
		throw new Error ("Invalid response object");
	}

	async function lrSettleAsyncScriptPromise(promiseId, func) {
		let result;
		try {
			result = await func();
			// lrSendSendMessage for result should be outside of try-catch
			// since there is no point to report its failure to the background page
			// using the same (already failed) method.
		} catch (ex) {
			lrSendMessage("asyncScript.reject", [ promiseId, lrToObject(ex) ]);
			throw ex;
		}
		lrSendMessage("asyncScript.resolve", [ promiseId, result ]);
	}

	async function getTargetElement(errorCb) {
		try {
			const bapi = typeof browser !== "undefined" ? browser : chrome;
			const menus =  bapi && (bapi.menus || bapi.contextMenus);
			if (menus && menus.getTargetElement) {
				const targetElementId = await lrSendMessage("store.getTargetElement", []);
				if (targetElementId != null) {
					return menus.getTargetElement(targetElementId);
				}
			}
		} catch (ex) {
			if (errorCb) {
				errorCb(ex);
			} else {
				console.error("LR: getTargetElement: %o", ex);
			}
		}
		// Likely useless, returns `BODY`.
		// `document.querySelectorAll(":focus")` returns empty node list.
		// Such fallback works for focusable elements as links however.
		// console.debug(document.activeElement, document.querySelectorAll(":focus"));
		return document.activeElement;
	}
	
	function getUrl(node, attr) {
		const hrefAttr = node.getAttribute(attr);
		if (!hrefAttr || hrefAttr === "#" || hrefAttr.startsWith("javascript:")) {
			return { error: "LrNoURL" };
		} else if (hrefAttr.startsWith("data:")) {
			return { value: "data:", error: "LrPlaceHolder" };
		}
		return lrNormalize(node[attr]);
	}

	function lrcAddDescriptor(node, array, { attribute, property, key }) {
		const value = node.getAttribute(attribute);
		if (value != null) {
			array.push({...lrNormalize(value), property, key});
		}
	}

	async function lrcImageProperties() {
		const result = [];
		function pushWarning(error, key) {
			result.push({
				property: 'warning',
				value: lrToObject(error),
				key: key || 'lr.image',
			});
		}

		const img = await getTargetElement(error => pushWarning(error, 'lr.image.getTargetElement'));
		if (img == null || img.nodeName != 'IMG') {
			// Maybe it is worth checking CSS background-url property
			throw new Error(`target element is not an image: ${img && img.nodeName}`);
		}

		result.push({ ...getUrl(img, 'src'), property: 'srcUrl', key: 'image.src' });
		const attrArray = [
			{ attribute: 'alt', property: 'imageAlt', key: 'image.alt' },
			{ attribute: 'title', property: 'imageTitle', key: 'image.title' },
		];
		for (const attr of attrArray) {
			try {
				lrcAddDescriptor(img, result, attr);
			} catch (ex) {
				result.push({...attr, error: lrToObject(ex)});
			}
		}
		return result;
	}

	try {
		const promiseId = lrRandomId();
		// async function does not block execution
		lrSettleAsyncScriptPromise(promiseId, lrcImageProperties);
		return { promise: promiseId };
	} catch (ex) {
		return { error: lrToObject(ex) };
	}
	return { error: "LR internal error: lrc_image.js: should not reach end of the function" };
})();
