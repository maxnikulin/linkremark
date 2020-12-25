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

(function linkRemark() {
	/** Error instances could not be passed through `sendMessage()` to backend */
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

	let warnings = [];
	const result = { warnings };
	try {
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
				lrSendMessage("asyncScript.reject", [ promiseId, lrToObject(ex), warnings ]);
				throw ex;
			}
			lrSendMessage("asyncScript.resolve", [ promiseId, result, warnings ]);
		}

		async function getTargetElement() {
			try {
				const targetElementId = await lrSendMessage("cache.getTargetElement", []);
				const menus = typeof browser !== "undefined" ? browser.menus : chrome.menus;
				if (targetElementId != null) {
					return menus.getTargetElement(targetElementId);
				}
			} catch (ex) {
				warnings.push(lrToObject(ex));
			}
			// Likely useless, return BODY. document.querySelectorAll(":focus")
			// returns empty node list.
			return document.activeElement;
		}
		
		function getAbsoluteURL(hrefAttr, node) {
			if (!hrefAttr || hrefAttr === "#" || hrefAttr.startsWith("javascript:") || hrefAttr.startsWith("data:")) {
				return null;
			}
			// TODO filter hrefAttr === node.baseURI
			return (new URL(hrefAttr, node.baseURI)).href;
		}

		function setProperty(src, attrName, object, name) {
			const value = src.getAttribute(attrName);
			if (value != null) {
				object[name] = value;
			}
		}

		function getText(node) {
			let result = null;
			try {
				result = node.innerText;
				if (result.length > 120) {
					// TODO more smart cut in background script
					result = result.substring(0, 120);
				}
				// TODO try to get text from title and alt elements inside (e.g. images)
				for (
					let parentNode = result.parent;
					result.length < 15 && parentNode !== document.html;
					parentNode = result.parentNode
				) {
					// TODO capture some text around <a> element, not whole parent text
					if (parentNode.innerText.length > 120) {
						break;
					}
					result = parentNode.innerText;
				}
			} catch (ex) {
				warnings.push(lrToObject(ex));
			}
			return result;
		}

		async function lrLinkProperties() {
			let link = await getTargetElement();
			// Original click target could be suitable if link text is too long
			for (; link != null && link.nodeName != 'A' && link != document.body; link = link.parentNode)
				;
			if (link == null || link.nodeName != 'A') {
				throw new Error(`target element is not a link: ${link && link.nodeName}`);
			}
			const obj = {};
			const href = getAbsoluteURL(link.getAttribute('href'), link);
			if (href) {
				obj.href = href;
			} else {
				warnings.push(lrToObject(new Error("Element <a> has no suitable href")));
			}
			setProperty(link, 'title', obj, 'linkTitle');
			setProperty(link, 'download', obj, 'linkDownload');
			setProperty(link, 'hreflang', obj, 'linkHreflang');
			setProperty(link, 'type', obj, 'linkType');
			const text = getText(link);
			if (text) {
				obj.text = text;
			}
			return obj;
		}

		const promiseId = lrRandomId();
		// async function does not block execution
		lrSettleAsyncScriptPromise(promiseId, lrLinkProperties);
		result.promise = promiseId;

		return result;
	} catch (ex) {
		result.error = lrToObject(ex);
		return result;
	} finally {
		if (warnings.length === 0) {
			delete result.warnings;
		}
		// clear warnings before async actions
		warnings = [];
	}
	return { error: "LR internal error: link.js: should not reach end of the function" };
})();
