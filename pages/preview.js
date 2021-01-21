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

var dumpElement = document.getElementById("dump");
var errorElement = document.getElementById("error");
var resultElement = document.getElementById("result");

function copyResult() {
	resultElement.select();
	const status = document.execCommand("copy");
	if (status) {
		pushActionResult("Copy to clipboard: OK", "success");
	} else {
		console.error("LR: copy failed");
		pushActionResult("Copy to clipboard failed", "error");
	}
	return status;
}

async function copyClose() {
	const status = copyResult();
	if (status) {
		window.close();
	}
}

function setCaptureResult(result) {
	const format = result && result.transport && result.transport.format;
	const formattedResult = format && result[format];
	const body = formattedResult && formattedResult.body;
	let text = null;
	if (typeof body === "string") {
		text = body;
	} else if (body != null) {
		text = JSON.stringify(body, null, "");
	}
	if (body != null) {
		setTitle(formattedResult.title);
		resultElement.textContent = text;
		return true;
	}
	return false;
}

async function lrFetchCachedResult() {
	try {
		const cachedResult = await lrSendMessage("cache.getLast");
		if (cachedResult == null) {
			throw new Error("Got no capture result");
		}
		const {result, debugInfo } = cachedResult;
		let success = lrNotFatal(setCaptureResult)(result);
		dumpElement.innerText = JSON.stringify(debugInfo, null, "  ");
		if (!success || (result && result.error)) {
			expandDebugInfo();
		}
		if (result && result.error) {
			const message = result.error.message || "Some error happened"
			if (success) {
				pushActionResult(message, "error");
				success = false;
			} else {
				throw new Error(message);
			}
		} else if (!success) {
			setTitle("No capture result");
			pushActionResult("No capture result");
		}
		if (!success) {
			// bypass catch but prevent launch
			return Promise.reject(new Error("Capture is not completely successful"));
		}
		return result;
	} catch (ex) {
		pushActionResult(ex, "error");
		pushActionResult("check extension console for errors", "error");
		setTitle("Error: " + ex);
		throw ex;
	}
}

var gLrGetPromise = lrFetchCachedResult();

var buttonCopyClose = document.getElementById("copyClose");
buttonCopyClose.addEventListener("click", copyClose);
var buttonCopy = document.getElementById("copy");
buttonCopy.addEventListener("click", copyResult);

const params = new URLSearchParams(window.location.search);
const action = params.get("action");
if (action == "launch") {
	lrLaunch();
}

async function lrLaunch() {
	let result = null
	try {
		result = await gLrGetPromise;
		if (await lrDoLaunch(result)) {
			pushActionResult("Closing the tab...");
			setTimeout(() => window.close(), 1000);
		}
	} catch (ex) {
		pushActionResult(ex.message, "error");
		pushActionResult("Try a button, please");
		if (result) {
			buttonCopyClose.focus();
		}
		throw ex;
	}
}

async function lrDoLaunch(result) {
	const { transport, ...capture } = result;
	if (transport.method === "clipboard") {
		if (!copyResult()) {
			throw new Error("Copy to clipboard failed");
		}
		return true;
	} else if (transport.method === "org-protocol") {
		const content = capture[transport.format];
		if (!transport.url) {
			throw new Error("Internal error: missed org-protocol url");
		}
		if (transport.clipboardForBody) {
			try {
				if (!copyResult()) {
					await navigator.clipboard.writeText(content);
				}
			} catch (ex) {
				throw new Error("Write to clipboard failed " + ex);
			}
		}
		window.location.href = transport.url;
		pushActionResult("launching org-protocol handler");
		return transport.handlerPopupSuppressed;
	} else {
		throw new Error("Unsupported method is configured: " + method);
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
	const wrapper = function(...args) {
		try {
			return func(...args);
		} catch (ex) {
			console.error("lrNotFatal: " + ( name || "anonymous" ), ex);
		}
	}
	if (name) {
		Object.defineProperty(func, "name", { value: name, configurable: true });
	}
	return wrapper;
}

var expandDebugInfo = lrNotFatal(function() {
	const details = document.getElementById("debugInfo");
	details.setAttribute("open", true);
});
