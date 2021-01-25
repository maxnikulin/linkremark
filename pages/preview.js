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

function setTitle(title) {
	document.title = title ? "LR: " + title : "LR Capture Preview";
	const pageTitle = byId("pageTitle");
	pageTitle.textContent = title ? "LinkRemark Capture: " + title
		: "LinkRemark Capture Preview";
}

function setCaptureResult(result) {
	const form = byId("params");
	const transport = result && result.transport;
	const format = transport && transport.format;
	const formattedResult = format && result[format];
	const body = formattedResult && formattedResult.body;
	let text = "";
	if (typeof body === "string") {
		text = body;
	} else if (body != null) {
		text = JSON.stringify(body, null, "");
	}
	const title = formattedResult && formattedResult.title;
	if (body != null) {
		setTitle(title);
		form.body.textContent = text;
	}
	if (title) {
		form.title.value = title;
	}
	const url = formattedResult && formattedResult.url;
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
}

async function lrFetchCachedResult() {
	const cachedResult = await lrSendMessage("cache.getLast");
	if (cachedResult == null) {
		throw new Error("Got no capture result");
	}
	const { result, debugInfo } = cachedResult;
	lrNotFatal(setCaptureResult)(result);
	const activeMethod = lrPreviewBind(result && result.transport);
	byId("dump").innerText = JSON.stringify(debugInfo, null, "  ");
	if (!activeMethod || (result && result.error)) {
		expandDebugInfo();
	}
	if (result && result.error) {
		const message = result.error.message || "Some error happened"
		throw new Error(message);
	} else if (!activeMethod) {
		const message = result ? "Capture is not completely successful"
			: "No capture result";
		throw new Error(message);
	}
	await lrNotFatal(fillFromSettings)();
	return activeMethod;
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
	async execClose() {
		try {
			if (await this.exec()) {
				pushActionResult("Closing the tab...");
				setTimeout(() => window.close(), 1000);
			}
		} catch (ex) {
			pushActionResult(ex.message, "error");
			pushActionResult("Try a button, please");
			this.execCloseButton.focus();
			throw ex;
		}
	}
	activate() {
		byId("detailsCapture").open = true;
		this.section.open = true;
		this.execCloseButton.focus();
		return true;
	}
	async copy() {
		try {
			const body = this.form.body;
			body.select();
			const status = document.execCommand("copy");
			if (!status) {
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
	activate() {
		const form = this.form;
		if (form.body.textContent || form.url.value || form.title.value) {
			return super.activate();
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
	activate() {
		return this.form.body.textContent ? super.activate() : false;
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

function lrPreviewBind(transport) {
	const method = transport && transport.method;
	let active = null;
	for (const Factory of [LrPreviewClipboardAction, LrPreviewOrgProtocolAction]) {
		const handler = new Factory();
		handler.register();
		if (handler.method === method) {
			active = handler;
			handler.activate();
			lrNotFatal(function lrAdjustTextAreaHeight() {
				const form = byId("params");
				const style = window.getComputedStyle(form.body);
				const line = parseFloat(style.lineHeight) || 1.2*(parseFloat(style.fontSize) || 12);
				const height = Math.min(50, form.body.scrollHeight / line);
				form.body.rows = height;
			})();
		}
	}
	if (!active) {
		throw new Error("Unsupported method is configured: " + method);
	}
	return active;
}

async function lrPreviewMain() {
	try {
		const activeMethod = await lrFetchCachedResult()
		const params = new URLSearchParams(window.location.search);
		const action = params.get("action");
		if (action == "launch") {
			activeMethod.execClose();
		}
	} catch (ex) {
		pushActionResult(ex, "error");
		pushActionResult("check extension console for errors", "error");
		setTitle("Error: " + ex);
		throw ex;
	}
}

lrPreviewMain();
