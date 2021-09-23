/*
   Copyright (C) 2021 Max Nikulin

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

/*
 * Browser action popup is shown only when other action is in progress.
 * Do not send errors from browser action popup to background pages.
 * Background scripts sends some errors to popup to notify users,
 * so sending errors in opposite direction can cause an infinite loop.
 */

"use strict";

var gLrbaBgConnection;
const lrbaIdPrefix = "status-";

function lrbaAddError(ex, title) {
	console.error("lrba: %o: %o", title, ex);
	try {
		const log = byId("log");
		const children = [];
		if (title != null && title != "") {
			children.push(String(title));
		}
		if (ex != null && ex != "") {
			children.push(String(ex.message || ex));
		}
		const li = E('li', { className: "status-error" }, children.join(": ") || "Internal error");
		log.insertBefore(li, log.firstChild);
	} catch (ex) {
		console.error("lrba: add error entry: %o", ex);
	}
}

function lrbaOnCancelClicked(e) {
	const idAttr = e.target.parentElement.id;
	if (!idAttr.startsWith(lrbaIdPrefix)) {
		console.error("lrbaOnCancelClicked: unsupported id attribute: %o %o", idAttr, e.target);
		return;
	}
	const id = idAttr.substring(lrbaIdPrefix.length);
	gLrbaBgConnection.postMessage({
		method: "cancel",
		params: [ id ],
	});
}

function lrbaOnStatus(entry) {
	try {
		console.debug("lrbaOnStatus: %o", entry);
		const { id, title, status } = entry;

		function lrba_setCancellable(li) {
			const cancellableClass = "cancellable";
			const isCancellable = status === "running" || status === "pending";
			if (isCancellable) {
				li.classList.add(cancellableClass);
			} else {
				li.classList.remove(cancellableClass);
			}
		}

		const existing = byId(lrbaIdPrefix + String(id));
		if (existing) {
			existing.className = "status-" + String(status);
			existing.firstChild.innerText = status;
			lrba_setCancellable(existing);
			return;
		}
		const statusList = byId("status");
		const button = E('button', null, "X");
		button.addEventListener("click", lrbaOnCancelClicked, false);
		const li = E(
			'li', {
				className: "status-" + String(status),
				id: lrbaIdPrefix + String(id),
			},
			E('span', { className: "statusType" }, status),
			" ",
			E('span', { className: "statusTitle" }, title),
			button,
		);
		lrba_setCancellable(li);
		statusList.insertBefore(li, statusList.firstChild);
	} catch (ex) {
		lrbaAddError(ex, "Update status");
	}
}

function lrbaOnMessage(request) {
	try {
		const { method, params } = request;
		switch (method) {
			case 'status':
				if (Array.isArray(params)) {
					for (const entry of params) {
						lrbaOnStatus(entry);
					}
				} else {
					lrbaOnStatus(params);
				}
				break;
			case 'error':
				if (Array.isArray(params)) {
					for (const error of params) {
						lrbaAddError(error, "Problem");
					}
				} else {
					lrbaAddError(params, "Problem");
				}
				break;
			default:
				lrbaAddError(method, "Unsupported notification");
		}
	} catch (ex) {
		lrbaAddError(ex, "Processing notification");
	}
}

function lrbaOnDisconnect(port) {
	port.onMessage.removeListener(lrbaOnMessage);
	port.onDisconnect.removeListener(lrbaOnDisconnect);
}

async function lrbaSendMessage(method) {
	try {
		await lrSendMessage(method);
	} catch (ex) {
		lrbaAddError(ex, method);
	}
}

async function lrbaMain() {
	try {
		byId("resetCaptures").addEventListener(
			"click", () => lrbaSendMessage("lock.reset"), false);
		byId("startCapture").addEventListener(
			"click", () => lrbaSendMessage("action.captureTab"), false);
	} catch (ex) {
		lrbaAddError(ex, "Init buttons");
	}
	try {
		gLrbaBgConnection = await bapi.runtime.connect();
		gLrbaBgConnection.onMessage.addListener(lrbaOnMessage);
		gLrbaBgConnection.onDisconnect.addListener(lrbaOnDisconnect);
		await gLrbaBgConnection.postMessage({ subscription: "captureStatus" });
	} catch (ex) {
		lrbaAddError(ex, "Init notification");
	}
}

lrbaMain();
