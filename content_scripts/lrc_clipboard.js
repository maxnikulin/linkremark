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

var lr_content_scripts = lr_content_scripts || {};

lr_content_scripts.lrcClipboard = async function lrcClipboard(capture) {
	const CLIPBOARD_TIMEOUT = 330;
	// In Firefox-115 ESR `document.execCommand("copy")` may propagate
	// to other documents. Chromium-127 is not affected.
	const ACTIVE_NODES = [ "FRAME", "IFRAME", "EMBED", "OBJECT" ];
	let warnings = [];

	/**
	 * Error instances could not be passed to background script
	 * due to JSON serialization in Chrome and various bugs in Firefox.
	 *
	 * In Firefox (tested v89, v114) content scripts `globalThis !== window`,
	 * so for `DOMException` caused by `navigator.clipboard.writeText`
	 * `instanceof Error` gives false while `instanceof window.Error`
	 * is true.  An exception may be thrown due to lack of focus
	 * (e.g. location bar is focused) or user action context
	 * (too long delay since last mouse click or keyboard event).
	 * */
	function lrToObject(obj) {
		console.error(obj);
		if (obj instanceof Error || obj instanceof window.Error) {
			var error = Object.create(null);
			if (obj.message != null) {
				error.message = obj.message;
			} else {
				error.message = String(obj);
			}
			if (obj.name != null) {
				error.name = String(obj.name);
			} else {
				error.name = Object.prototype.toString.call(obj);
			}
			// TODO DOMException stack may be undefined
			for (let prop of ["code", "stack", "fileName", "lineNumber", "columnNumber"]) {
				const value = obj[prop];
				if (value == null) {
					continue;
				}
				if (typeof value !== "string") {
					// FIXME added to preserve `Number`, actually may cause problems
					// due to failure of structured clone.
					error[prop] = value;
					continue;
				}
				// Make `stack` readable in `JSON.stringify()` dump.
				const lines = value.trim().split("\n");
				error[prop] = lines.length > 1 ? lines : value;
			}
			return error;
		} else {
			return obj;
		}
	}

	// Duplicate: lpr_preview.js, similar: lr_settings.js
	/* async */ function withTimeout(promise, timeout) {
		if (!(timeout >= 0)) {
			console.error("Invalid timeout", timeout);
			return promise;
		}
		const deferred = {
			resolve(reason) {
				this._resolve?.(reason);
				this.destroy?.();
			},
			reject(ex) {
				this._reject?.(ex ?? new Error("Aborted"));
				this.destroy?.();
			},
			destroy() {
				if (this._timeoutId !== undefined) {
					clearTimeout(this._timeoutId);
				}
				this._timeoutId = this._reject = this._resolve
					= this.destroy = undefined;
			}
		};
		const bound_reject = deferred.reject.bind(deferred);
		promise.then(deferred.resolve.bind(deferred), bound_reject);
		return new Promise((resolve, reject) => {
			deferred._resolve = resolve;
			deferred._reject = reject;
			deferred._timeoutId = setTimeout(bound_reject, timeout);
		});
	}

	function lrIsGecko() {
		return chrome.runtime.getURL("/").startsWith("moz-extension:/");
	}

	function lrcSaveSelection(log) {
		const ranges = [];
		try {
			const selection = window.getSelection();
			const { rangeCount } = selection;
			for (let i = 0; i < rangeCount; ++i) {
				ranges.push(selection.getRangeAt(i).cloneRange());
			}
		} catch(ex) {
			Promise.reject(ex);
			log?.push?.(lrToObject(ex));
		}
		return function lrRestoreSelection(ranges, active, log) {
			try {
				const selection = window.getSelection();
				selection.removeAllRanges();
				for (const r of ranges) {
					selection.addRange(r);
				}
			} catch(ex) {
				Promise.reject(ex);
				log?.push?.(lrToObject(ex));
			}
			try{
				active?.focus?.();
			} catch(ex) {
				Promise.reject(ex);
				log?.push?.(lrToObject(ex));
			}
		}.bind(null, ranges, document.activeElement, log);
	}

	function lrcMakeTempInput(text, log) {
		try {
			const input = document.createElement("textarea");
			input.setAttribute("aria-hidden", "true");
			// Huge negative left and top are not used.
			// Perhaps they might cause accidental scroll.
			input.style.heigth = "0px";
			input.style.overflow = "hidden";
			input.style.position = "absolute";
			input.value = text;
			document.body.appendChild(input);
			input.select();
			return document.body.removeChild.bind(document.body, input);
		} catch (ex) {
			Promise.reject(ex);
			log?.push?.(lrToObject(ex));
		}
	}

	function lrCopyUsingEvent(text) {
		// Document may install copy event interceptor earlier.
		let listenerInvoked = false;
		const listener = function lrc_oncopy(text, log, event) {
			try {
				event.stopImmediatePropagation();
				event.preventDefault();
				event.clipboardData.clearData();
				event.clipboardData.setData("text/plain", text);
				listenerInvoked = true;
			} catch (ex) {
				Promise.reject(ex);
				log?.push?.(lrToObject(ex));
			}
		}.bind(null, text, warnings);
		const listenerOptions = { capture: true };
		window.addEventListener("copy", listener, { once: true, ...listenerOptions });

		const active = document.activeElement?.nodeName?.toUpperCase?.();
		const needsInput = lrIsGecko() && ACTIVE_NODES.indexOf(active) >= 0;
		const restoreSelection = needsInput ? lrcSaveSelection(warnings) : undefined;
		const removeInput = needsInput ? lrcMakeTempInput(text, warnings) : undefined;
		let result;
		try {
			result = document.execCommand("copy");
		} finally {
			window.removeEventListener("copy", listener, listenerOptions);
			removeInput?.();
			restoreSelection?.();
		}
		if (!result) {
			throw new Error("Copy using command and event listener failed");
		} else if (!listenerInvoked) {
			throw new Error("Document overrides copy action");
		}
		return result;
	}

	const retval = { warnings };
	try {
		async function lrLaunchProtocolHandlerFromContentScript(url, detectUnconfigured) {
			if (!url) {
				throw new Error("No URL to launch external protocol handler");
			}

			// Almost certainly has no effect
			window.focus();

			if (!detectUnconfigured || !document.hasFocus()) {
				window.location.href = url;
				if (detectUnconfigured) {
					console.log("LR: document is not focused, no way to detect failure");
					warnings.push({
						name: "LrWarning",
						message: "Document is not focused, external handler error may be silent",
						fileName: "lrc_clipboard.js",
					});
				}
				return true;
			}

			// Warning: page may has its own "blur" listener causing false error.
			// Warning: does not when location bar is focused, not page content (see code above).
			// Warning: false positives when Gnome shows application chooser
			// for Firefox snap package. (Firefox has another application chooser).
			// Warning: timeout may be not enough for Firefox as snap package.
			// Warning: false positive when handler does not have a window
			// (likely the case of `:immediate t` templates).
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
					await withTimeout(navigator.clipboard.writeText(text), CLIPBOARD_TIMEOUT);
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
				} else {
					// Firefox `DOMException` does not allow `ex.message = ...`:
					//     TypeError: setting getter-only property "message"
					Object.defineProperty(ex, "message", {
						value: "navigator.clipboard: " + ex.message,
						configurable: true,
						writable: true,
						enumerable: true,
					});
				}
				warnings.push(lrToObject(ex));
			}
			// Does not help e.g. in the case of `alert` in a copy event listener.
			// If `alert` is called earlier then content script execution is postponed.
			return await withTimeout(
				(async () => lrCopyUsingEvent(text))(), CLIPBOARD_TIMEOUT);
		}

		async function lrGetCaptureCopyLaunch(capture) {
			const { transport, formats } = capture;
			const content = formats[transport.captureId];
			if (transport.method === "clipboard") {
				const text = content.format === "org-protocol" ? content.url : content.body;
				if (text == null || text === "") {
					throw new Error("Internal error: nothing to copy");
				}
				return await lrClipboardCopyFromContentScript(text);
			} else if (transport.method === "org-protocol") {
				await lrClipboardCopyFromContentScript(content.body);
				await lrLaunchProtocolHandlerFromContentScript(
					content.url, content.options && content.options.detectUnconfigured);
				return true;
			}
			throw new Error(`Unsupported method ${method}`);
		}

		retval.result = await lrGetCaptureCopyLaunch(capture);
		return retval;
	} catch (ex) {
		retval.error = lrToObject(ex);
		return retval;
	} finally {
		if (warnings.length === 0) {
			delete retval.warnings;
		}
	}
	return { error: "LR internal error: lrc_clipboard.js: should not reach end of the function" };
	//# sourceURL=content_scripts/lrc_clipboard_func.js
};
