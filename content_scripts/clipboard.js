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

(function lrClipboardWrite() {
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

		async function lrLaunchProtocolHandlerFromContentScript(url) {
			if (url) {
				window.location.href = url;
			}
		}

		async function lrClipboardCopyFromContentScript(content) {
			if (content != null) {
				const text = typeof content === "string" ? content : JSON.stringify(content, null, "  ");
				// const permission = await navigator.permissions.query({name: 'clipboard-write'});
				// console.log("lrClipboardWrite permission", permission);
				await navigator.clipboard.writeText(text);
			}
		}

		async function lrPostResultFromContentScript() {
			const {transport, ...capture} = await lrSendMessage("cache.getLastResult");
			const content = capture[transport.format];
			if (transport.method === "clipboard") {
				await lrClipboardCopyFromContentScript(content.body);
			} else if (transport.method === "org-protocol") {
				if (transport.clipboardForBody) {
					await lrClipboardCopyFromContentScript(content.body);
				}
				await lrLaunchProtocolHandlerFromContentScript(transport.url);
			} else {
				throw new Error(`Unsupported method ${method}`);
			}

			return true;
		}

		if (!navigator.clipboard || !navigator.clipboard.writeText) {
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
	return { error: "LR internal error: clipboard.js: should not reach end of the function" };
})();
