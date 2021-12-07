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

/* Copy capture result to clipboard or launch org-protocol: handler
 * using content script. Looks like a preferred way for org-protocol:
 * handler. Does not work on privileged pages. Chrome does not
 * allow `navigator.clipboard.writeText` from background page so
 * this page might help to avoid opening of the preview page.
 * This script is not called unless a users disables preview in add-on settings.
 */

"use strict";

(function lrc_clipboard() {
	/**
	 * Error instances could not be passed through `sendMessage()` to backend
	 *
	 * If cursor is in developer tools console, clicking on browser action
	 * button can raise object that is not `instance of Error` despite it has
	 * `Error` in prototype chain (maybe it is form other `window`). Firefox-89.
	 * */
	function lrToObject(obj) {
		if (obj instanceof Error || obj instanceof DOMException) {
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

	function lrCopyUsingEvent(text) {
		let status = null;
		// Document may install copy event interceptor earlier.
		let listenerInvoked = false;
		function lrc_oncopy(event) {
			document.removeEventListener("copy", lrc_oncopy, true);
			event.stopImmediatePropagation();
			event.preventDefault();
			event.clipboardData.clearData();
			event.clipboardData.setData("text/plain", text);
			listenerInvoked = false;
		}
		document.addEventListener("copy", lrc_oncopy, true);

		let result;
		try {
			result = document.execCommand("copy");
		} finally {
			document.removeEventListener("copy", lrc_oncopy, true);
		}
		if (!result) {
			throw new Error("Copy using command and event listener failed");
		} else if (!listenerInvoked) {
			throw new Error("Document overrides copy action");
		}
		return result;
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

		async function lrLaunchProtocolHandlerFromContentScript(url) {
			if (!url) {
				throw new Error("No URL to launch external protocol handler");
			}

			// Almost certainly has no effect
			window.focus();

			if (!document.hasFocus()) {
				console.log("LR: document is not focused, no way to detect failure");
				window.location.href = url;
				warnings.push({
					name: "LrWarning",
					message: "Document is not focused, external handler error may be silent",
					fileName: "lrc_clipboard.js",
				});
				return true;
			}

			// Warning: page may has its own "blur" listener causing false error.
			let resolve, timeout;
			function lrProtocolHandlerResolve(_evt) {
				if (!resolve) {
					return;
				}
				// Do not resolve with event
				resolve(true);
				resolve = null;
				clearTimeout(timeout);
			}
			try {
				document.addEventListener("blur", lrProtocolHandlerResolve);
				window.addEventListener("blur", lrProtocolHandlerResolve);
				const promise = new Promise((res, rej) => {
					resolve = res;
					timeout = setTimeout(rej, 500, new Error("org-protocol: handler is not configured"));
				});
				window.location.href = url;
				return await promise;
			} finally {
				window.removeEventListener("blur", lrProtocolHandlerResolve);
				document.removeEventListener("blur", lrProtocolHandlerResolve);
			}
		}

		async function lrClipboardCopyFromContentScript(content) {
			if (content == null || content === "") {
				return false;
			}
			const text = typeof content === "string" ? content : JSON.stringify(content, null, "  ");
			// const permission = await navigator.permissions.query({name: 'clipboard-write'});
			// console.log("lrClipboardWrite permission", permission);
			try {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					await navigator.clipboard.writeText(text);
					return true;
				} else {
					warnings.push(lrToObject(new Error("navigator.clipboard API is disabled")));
				}
			} catch (ex) {
				// https://bugzilla.mozilla.org/show_bug.cgi?id=1670252
				// Bug 1670252 navigator.clipboard.writeText rejects with undefined as rejection value
				// Fixed in Firefox-85
				if (ex === undefined) {
					ex = new Error("navigator.clipboard.writeText not allowed");
				}
				warnings.push(lrToObject(ex));
			}
			return lrCopyUsingEvent(text);
		}

		async function lrPostResultFromContentScript() {
			const { transport, formats } = await lrSendMessage("store.getCapture");
			const content = formats[transport.captureId];
			if (transport.method === "clipboard") {
				const text = content.format === "org-protocol" ? content.url : content.body;
				if (text == null || text === "") {
					throw new Error("Internal error: nothing to copy");
				}
				return await lrClipboardCopyFromContentScript(text);
			} else if (transport.method === "org-protocol") {
				await lrClipboardCopyFromContentScript(content.body);
				await lrLaunchProtocolHandlerFromContentScript(content.url);
				return true;
			}
			throw new Error(`Unsupported method ${method}`);
		}

		if (!navigator.clipboard || !navigator.clipboard.writeText) {
			// TODO Is where a way to disable `navigator.clipboard`?
			// Have not managed to do it in Firefox-93 but it might cause fallback
			// to preview page for org-protocol export.
			return { error: lrToObject(new Error("Clipboard is disabled")) };
		}
		const promiseId = lrRandomId();
		// async function does not block execution
		lrSettleAsyncScriptPromise(promiseId, lrPostResultFromContentScript);
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
	return { error: "LR internal error: lrc_clipboard.js: should not reach end of the function" };
})();
