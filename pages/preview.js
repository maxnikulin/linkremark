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

var gLrGetPromise = bapi.runtime.sendMessage({method: "cache.getLast", params: []}).then(response => {
	console.log("received %o", response);
	if (response != null) {
		const {result, error, ...other} = response;
		if (error != null) {
			pushActionResult(JSON.stringify(error, null, "  "), "error");
		}
		const top_result = result;
		if (top_result != null) {
			const {result, debugInfo} = top_result;
			const format = result && result.transport && result.transport.format;
			let text = result && format && result[format] && result[format].body || result;
			if (typeof text !== "string" && text != null) {
				text = JSON.stringify(result, null, "  ");
			}
			resultElement.textContent = text;
			dumpElement.innerText = JSON.stringify(debugInfo, null, "  ");
			if (result && result.error) {
				pushActionResult(result.error.message || "Some error happened", "error");
				expandDebugInfo();
			}
			return result;
		}
	} else {
		pushActionResult("got null response", "error");
	}
});

gLrGetPromise.catch(e => {
	pushActionResult("" + e, "error");
	throw e;
});

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
	try {
		if (await lrDoLaunch()) {
			pushActionResult("Closing the tab...");
			setTimeout(() => window.close(), 1000);
		}
	} catch (ex) {
		pushActionResult(ex.message, "error");
		pushActionResult("Try a button, please");
		buttonCopyClose.focus();
		throw ex;
	}
}

async function lrDoLaunch() {
	const result = await gLrGetPromise;
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
