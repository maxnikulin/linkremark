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

function byId(id) {
	return document.getElementById(id);
}

/** Do not omit undefined values, convert them to to `null` */
function jsonStringify(obj) {
	return JSON.stringify(obj, (k, v) => v !== undefined ? v : null, "  ");
}

function setTitle(title) {
	document.title = title ? "LR: " + title : "LR Capture Preview";
	const pageTitle = byId("pageTitle");
	pageTitle.textContent = title ? "LinkRemark Capture: " + title
		: "LinkRemark Capture Preview";
}

function captureFormatMap(result) {
	const retval = {};
	for (let capture, { captureId } = result && result.formats && result.transport || {};
		null != (capture = captureId && result.formats[captureId]);
		captureId = capture.src
	) {
		if (!(capture.format in retval)) {
			retval[capture.format] = capture;
		}
	}
	return retval;
}

function setCaptureResult(capture) {
	const form = byId("params");
	const body = capture && capture.body || capture;
	let text = "";
	if (typeof body === "string") {
		text = body;
	} else if (body != null) {
		text = jsonStringify(body);
	}
	if (body != null) {
		form.body.textContent = text;
		lrNotFatal(function lrAdjustTextAreaHeight(textarea) {
			const maxHeight = 50;
			const reserve = 2;
			/* Approach with `getComputedStyle` is less reliable
			 * due to `lineHeight` may be `normal` and proper factor
			 * for fontSize is rather uncertain. */
			const height = Math.ceil(textarea.scrollHeight/(textarea.clientHeight/textarea.rows));
			textarea.rows = Math.min(maxHeight, height + reserve);
		})(form.body);
	}
	const title = capture && capture.title;
	if (typeof title === "string") {
		setTitle(title);
		form.title.value = title;
	} else {
		setTitle();
	}
	const url = capture && capture.url;
	if (url) {
		form.url.value = url;
	}
}

async function fillFromSettings() {
	const settings = await lrSendMessage("settings.get", [
		"export.methods.orgProtocol.template",
		"export.methods.orgProtocol.clipboardForBody",
		"export.methods.orgProtocol.handlerPopupSuppressed",
	]);
	const form = byId("params");
	form.template.value = settings["export.methods.orgProtocol.template"];
	form.clipboardForBody.checked = settings["export.methods.orgProtocol.clipboardForBody"];
	form.handlerPopupSuppressed.checked
		= settings["export.methods.orgProtocol.handlerPopupSuppressed"];
	form.handlerPopupSuppressed.dispatchEvent(new Event("change"));
}

async function lrFetchCachedResult() {
	const cachedResult = await lrSendMessage("cache.getLast");
	if (cachedResult == null) {
		throw new Error("Got no capture result");
	}
	const { result, debugInfo } = cachedResult;
	byId("dump").innerText = jsonStringify(debugInfo);
	if (result && result.error) {
		expandDebugInfo();
	}
	if (result && result.error) {
		const message = result.error.message || "Some error happened"
		throw new Error(message);
	}
	return result;
}

async function closeWindow(action) {
	const CLOSE_SELF = 1;
	const CLOSE_FF_ESR_POLYFILL = 2;
	switch (action) {
		case CLOSE_SELF:
			setTimeout(closeWindow, 100, CLOSE_FF_ESR_POLYFILL);
			window.close();
			break;
		case CLOSE_FF_ESR_POLYFILL:
			try {
				await lrSendMessage("polyfill.closeTab");
			} catch (ex) {
				pushActionResult(ex.message, "error");
			}
			break;
		default:
			setTimeout(closeWindow, 1000, CLOSE_SELF);
	}
}

class LrPreviewTransportAction {
	register() {
		this.form = byId("params");
		this.handleExecOnly = this.withPreventDefault(this.exec);
		this.execOnlyButton.addEventListener("click", this.handleExecOnly);
		this.handleExecClose = this.withPreventDefault(this.execClose);
		this.execCloseButton.addEventListener("click", this.handleExecClose);
	}
	withPreventDefault(action) {
		return function(ev) {
			ev.preventDefault();
			action.call(this);
		}.bind(this);
	}
	async execClose(ev) {
		try {
			if (await this.exec()) {
				pushActionResult("Closing the tab...");
				await closeWindow();
			}
		} catch (ex) {
			pushActionResult(ex.message, "error");
			if (!ev) {
				// launch from lrPreviewMain
				pushActionResult("Try a button, please");
			}
			this.execCloseButton.focus();
			throw ex;
		}
	}
	activate(transport) {
		const method = transport && transport.method;
		if (this.method !== method) {
			return false;
		}
		this.section.open = true;
		if (this.execCloseButton.disabled) {
			this.execOnlyButton.focus();
		} else {
			this.execCloseButton.focus();
		}
		return this;
	}
	async copy() {
		try {
			const body = this.form.body;
			body.select();
			const status = document.execCommand("copy");
			if (!status) {
				if (!navigator.clipboard || !navigator.clipboard.writeText) {
					throw new Error("Clipboard API is disabled");
				}
				await navigator.clipboard.writeText(body.textContent);
			}
		} catch (ex) {
			console.error("LR: preview: navigator.clipboard.writeText");
			console.error(ex);
			throw new Error("Write to clipboard failed " + ex);
		}
		pushActionResult("Copy to clipboard: OK", "success");
		return true;
	}
}

class LrPreviewOrgProtocolAction extends LrPreviewTransportAction {
	constructor() {
		super();
		this.method = "org-protocol";
		this.execOnlyButton = byId("orgProtocolLaunch");
		this.execCloseButton = byId("orgProtocolLaunchClose");
		this.section = byId("detailsOrgProtocol");
	}
	register() {
		super.register();
		const handler = (ev) => (this.execCloseButton.disabled
			= !this.form.handlerPopupSuppressed.checked);
		this.form.handlerPopupSuppressed.addEventListener("change", handler);
		// It seems, firefox could preserve checkbox states
		// after page reload. Prevent confusing behavior during debugging.
		handler();
	}
	async exec() {
		const form = this.form;
		const params = {
			template: form.template.value,
			url: form.url.value,
			title: form.title.value,
		};
		if (form.clipboardForBody.checked) {
			await this.copy();
		} else {
			params.body = form.body.textContent;
		}
		window.location.href = lrOrgProtocol.makeUrl(params);
		pushActionResult("launching org-protocol handler");
		return form.handlerPopupSuppressed.checked;
	}
	activate(transport) {
		const form = this.form;
		if (form.body.textContent || form.url.value || form.title.value) {
			return super.activate(transport);
		}
		return false;
	}
}

class LrPreviewClipboardAction extends LrPreviewTransportAction {
	constructor() {
		super();
		this.method = "clipboard";
		this.execOnlyButton = byId("copy");
		this.execCloseButton = byId("copyClose");
		this.section = byId("detailsClipboard");
	}
	async exec() {
		if (!this.copy()) {
			throw new Error("Copy to clipboard failed");
		}
		return true;
	}
	activate(transport) {
		return this.form.body.textContent ? super.activate(transport) : false;
	}
}

function pushActionResult(msg, cls) {
	if (cls != null && cls !== "success") {
		console.error(msg);
	}

	const ul = document.getElementById('actionResult');
	const children = ul.children;
	if (children.length >= 5) {
		children[0].remove();
	}
	const firstChild = ul.firstChild;
	if (firstChild.nodeName === "#text") {
		firstChild.remove();
	}
	const li = document.createElement('li');
	if (cls) {
		li.className = cls;
	}
	li.append(document.createTextNode(msg));
	ul.append(li)
	ul.append(document.createTextNode('\n'));
}

function lrNotFatal(func, name) {
	if (!name) {
		name = func.name;
	}
	let wrapper;
	if (Object.prototype.toString.call(func) === '[object AsyncFunction]') {
		wrapper = async function(...args) {
			try {
				return await func(...args);
			} catch (ex) {
				console.error("lrNotFatal: %s %s %o", name || "anonymous", ex, ex);
			}
		}
	} else {
		wrapper = function(...args) {
			try {
				return func(...args);
			} catch (ex) {
				console.error("lrNotFatal: %s %s %o", name || "anonymous", ex, ex);
			}
		}
	}
	if (name) {
		Object.defineProperty(wrapper, "name", { value: name, configurable: true });
	}
	return wrapper;
}

var expandDebugInfo = lrNotFatal(function() {
	const details = document.getElementById("debugInfo");
	details.setAttribute("open", true);
});

function lrPreviewBind() {
	lrNotFatal(function() {
		const link = byId("settings");
		link.addEventListener("click", openSettings, false);
	})();
	return [LrPreviewClipboardAction, LrPreviewOrgProtocolAction].map(
		Factory => {
			const handler = new Factory();
			handler.register();
			return handler;
		}
	);
}

// Array.prototype.some returns true, not value returned by passed function.
function someValue(array, fun) {
	for (const e of array) {
		const result = fun(e);
		if (result) {
			return result;
		}
	}
}

function openSettings(ev) {
	function onOpenOptionsPageError(ex) {
		console.error("lr_action.openSettings: runtime.openOptionsPage: %o", ex);
		const link = byId("settings");
		// Next time use default browser action to open link target.
		link.removeEventListener("click", openSettings);
	}
	try {
		bapi.runtime.openOptionsPage().catch(onOpenOptionsPageError);
		ev.preventDefault();
	} catch (ex) {
		onOpenOptionsPageError(ex);
	}
}

async function lrPreviewMain() {
	try {
		const handlers = lrPreviewBind();
		const captureResultPromise = lrFetchCachedResult()
		const settingsPromise = lrNotFatal(fillFromSettings)();
		await settingsPromise;
		const captureResult = await captureResultPromise;
		const formatMap = captureFormatMap(captureResult);
		// ignore org-protocol
		const formatted = formatMap.org || formatMap.object;
		lrNotFatal(setCaptureResult)(formatted);
		const transport = captureResult && captureResult.transport;
		const activeMethod = someValue(handlers, h => h.activate(transport));
		if (activeMethod) {
			const params = new URLSearchParams(window.location.search);
			const action = params.get("action");
			if (action == "launch") {
				await activeMethod.execClose();
			}
		} else {
			expandDebugInfo();
			let message;
			if (captureResult) {
				const method = captureResult && captureResult.transport && captureResult.transport.method;
				message = method ? "Unsupported method is configured: " + method
					: "Capture is not completely successful";
			}
			throw new Error(message || "No capture result");
		}
	} catch (ex) {
		pushActionResult(ex, "error");
		pushActionResult("check extension console for errors", "error");
		setTitle("Error: " + ex);
		throw ex;
	}
}

lrPreviewMain();
