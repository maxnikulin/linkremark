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

lr_content_scripts.lrcClipboard = async function lrcClipboard(capture, params) {
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
			if (result === true) {
				result = "contentScript.document.execCommand";
			}
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

		async function lrcClipboardTryNavigator(params) {
			try {
				return lrIsGecko()
					|| params?.hasClipboardWrite
					|| (await chrome.runtime.sendMessage(
						{ method: "export.checkUserGesture" }))?.result;
				
			} catch (ex) {
				Promise.reject(ex);
			}
			return false
		}

		async function lrClipboardCopyFromContentScript(content, params) {
			if (content == null || content === "") {
				return false;
			}
			const text = typeof content === "string" ? content : JSON.stringify(content, null, "  ");
			try {
				if (navigator.clipboard?.writeText === undefined) {
					// TODO send log to background script, but not as warnings
					warnings.push(lrToObject(new Error(`navigator.clipboard API disabled for ${location.protocol}`)));
				} else if (!(await lrcClipboardTryNavigator(params))) {
					// Try `navigator.clipboard.writeText` first because
					// it can not be intercepted by a "copy" event listener added
					// by the web page.
					//
					// A permission popup prompt **on behalf of the page**
					// may appear on attempt to call the method
					// in Chromium (tested in v112, v127).
					// The condition above is aimed to use the method only when
					// it can be used silently. Try to avoid disturbing users
					// by popups and granting additional privileges to web sites.
					//
					// Even when the `clipboardWrite` permission is granted
					// to the extension, the function call may throw,
					// if the page document is not focused.
					// To check `document.hasFocus()` may be used,
					// but currently it is skipped.
					//
					// **Permission popup prompt**
					//
					// It is not implemented in Firefox as of v115 ESR.
					// It is not considered as a bug in Chromium, see
					// <https://crbug.com/1382608> (WontFix)
					// "WebExtension Content Script: navigator.clipboard triggers permission dialog"
					//
					// The dialog
					//
					// > "This {origin|"file"} wants to
					// >
					// > See text and images copied to clipboard".
					//
					// is rather confusing because:
					// - Its text is more suitable for the **clipboard-read** permission
					//   despite `writeText` actual call.
					// - Permission is requested for the **page origin**, not the extension.
					//   User may prefer to avoid granting clipboard access to the whole
					//   web site.
					//
					// The returned promise is not settled till the user closes the popup.
					// It breaks timeout-based error detection in content script.
					// When not allowed `DOMException: Write permission denied.` happens.
					//
					// Clicking on extension action in the toolbar or invoking a command
					// (shortcut) does not refresh user gesture context.
					// The popup does not appear and text is copied to clipboard
					// within a few seconds after a mouse click,
					// including right click to invoke context menu,
					// or keyboard navigation on the page.
					// It does not actually matters which way extension action is invoked:
					// the toolbar action button or its menu, a command (keyboard shortcut),
					// or context menu. Context menu sets user gesture context
					// when it is invoked, not when particular item is selected,
					// so permission popup depends on delay.
					//
					// There is no point to query permissions from `navigator`
					// because the returned values are always the same,
					// even when the document is not focused:
					//
					//     navigator.permissions.query({name: 'clipboard-write', allowWithoutGesture: true})
					//     // => {name: 'clipboard_write', state: 'prompt', ...}
					//     navigator.permissions.query({name: 'clipboard-write', allowWithoutGesture: false})
					//     // => {name: 'clipboard_write', state: 'granted', ...}
					//
					// Notice that in Firefox (e.g. v112) the same query causes `TypeError`
					// due to unsupported `clipboard-write` permission
					// <https://searchfox.org/mozilla-central/source/dom/webidl/Permissions.webidl>
					// <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/permissions/permission_descriptor.idl>
					// In addition the `allowWithoutGesture` parameter
					// is not supported by Firefox as well.
					// <https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/permissions/clipboard_permission_descriptor.idl>
					//
					// ** Focus **
					//
					// If document is not focused the returned promise is rejected with
					//
					//     DOMException: Document is not focused.
					//
					// Notice that focus is lost when other browser UI element is focused:
					// location bar, side bar, developer tools,
					// `[F6]` is pressed to get keyboard focus on e.g. tab labels.
					// The document however remains focused when
					// extension action or tab label is clicked
					// (even if it is in the extension drop-down menu).
					warnings.push(lrToObject(new Error("Skip navigator.clipboard to avoid user prompt")));
				} else {
					await withTimeout(navigator.clipboard.writeText(text), CLIPBOARD_TIMEOUT);
					return "contentScript.navigator.clipboard.writeText";
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

		async function lrGetCaptureCopyLaunch(capture, params) {
			const { transport, formats } = capture;
			const content = formats[transport.captureId];
			if (transport.method === "clipboard") {
				const text = content.format === "org-protocol" ? content.url : content.body;
				if (text == null || text === "") {
					throw new Error("Internal error: nothing to copy");
				}
				return await lrClipboardCopyFromContentScript(text, params);
			} else if (transport.method === "org-protocol") {
				await lrClipboardCopyFromContentScript(content.body, params);
				await lrLaunchProtocolHandlerFromContentScript(
					content.url, content.options && content.options.detectUnconfigured);
				return true;
			}
			throw new Error(`Unsupported method ${method}`);
		}

		retval.result = await lrGetCaptureCopyLaunch(capture, params);
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
