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

var lr_action = function() {
	this.createMenu = function() {
		const itemArray = [
			{
				contexts: [ "all" ],
				enabled: true,
				id: "LR_FRAME_REMARK",
				// custom commands do not work here
				// command: "page_remark",
				title: "Remark for the page",
			},
			{
				contexts: [ "browser_action" ],
				enabled: true,
				id: "LR_SETTINGS",
				title: "Settings",
			},
			{
				contexts: [ "browser_action" ],
				enabled: true,
				id: "LR_PREVIEW",
				title: "Debug info",
			},
			{
				contexts: [ "image" ],
				id: "LR_IMAGE_REMARK",
				title: "Remark for this image",
			},
			{
				contexts: [ "link" ],
				id: "LR_LINK_REMARK",
				title: "Remark for this link",
			},
		];
		for (const item of itemArray) {
			lr_action.createMenuItem(item);
		}
	};

	this.createMenuItem = function(details, error_cb = null) {
		return bapi.contextMenus.create(details, function lrCreateMenuCallback() {
			if (bapi.runtime.lastError) {
				console.error("LR: createMenu", details, bapi.runtime.lastError);
			}
			if (error_cb) {
				error_cb();
			}
		});
	};
	
	this.contextMenuListener = async function(clickData, tab) {
		// clickData.viewType[extension.ViewType]: "tab" for page, "popup", "sidebar",
		// undefined for browserAction
		try {
			switch (clickData.menuItemId) {
				case "LR_PREVIEW":
					await lr_action.openPreview(tab);
					break;
				case "LR_SETTINGS":
					await lr_action.openSettings(tab);
					break;
				case "LR_FRAME_REMARK":
					await lr_action.contextMenuHandler(clickData, tab, "frame");
					break;
				case "LR_IMAGE_REMARK":
					await lr_action.contextMenuHandler(clickData, tab, "image");
					break;
				case "LR_LINK_REMARK":
					await lr_action.contextMenuHandler(clickData, tab, "link");
					break;
				default:
					throw new Error("Unknown menu item");
					break;
			}
		} catch (ex) {
			console.error("LR: contextMenuListener error", clickData, tab);
			throw ex;
		}
	};

	this.contextMenuHandler = function(clickData, tab, type) {
		const {
			pageUrl, frameId, frameUrl,
			selectionText, linkText, linkUrl, mediaType, srcUrl,
			targetElementId,
		} = clickData || {};
		const target = {
			tabId: tab && tab.id,
			pageUrl, frameId, frameUrl,
			selectionText, linkText, linkUrl, mediaType, srcUrl,
			targetElementId,
			captureObject: type,
		};
		return captureTabFocusedFrame(tab, target);
	};

	this.commandListener = async function(command) {
		// Unused for a while. Other actions are invoked through context menu
		try {
			switch (command) {
			// is not fired, processed through browserAction.onClicked
			// case '_execute_browser_action':
			case 'page_remark':
				return await captureTabFocusedFrame(null, null);
				break;
			default:
				throw new Error(`Unsupported command ${command}`);
				break;
			}
		} catch (ex) {
			console.error("LR: commandListener error", command);
			throw ex;
		}
	};

	this.browserActionListenerAsync = async function(tab, onClickData) {
		/* onClickData is a firefox-72 feature that should be handy
		 * to support additional actions with Shift or Ctrl
		 * but it is unsupported by other browsers
		 * https://bugzilla.mozilla.org/show_bug.cgi?id=1405031
		 * "Support additional click events for browserAction and pageAction"
		 */
		return /* await */ captureTabFocusedFrame(tab, null);
	};

	this.browserActionListener = function(tab, onClickData) {
		/* Call async function through a wrapper to get error in extension
		 * dev tools in Firefox that otherwise reported to browser console.
		 * Absence of `console.error` allows to avoid duplicated error in Chrome.
		 * Workaround for:
		 * https://bugzilla.mozilla.org/1398672
		 * "1398672 - Add test for better logging of exceptions/rejections from async event"
		 */
		captureTabFocusedFrame(tab, null);
	}

	this.openPreview = async function(tab, {action} = {}) {
		const url = new URL(bapi.runtime.getURL("pages/preview.html"));
		if (action) {
			const query = new URLSearchParams();
			query.set("action", action);
			url.search = query.toString();
		}
		return await bapi.tabs.create({
			url: url.toString(),
			openerTabId: tab && tab.id,
			windowId: tab && tab.windowId,
		});
	};

	this.openSettings = async function(tab) {
		try {
			return await bapi.runtime.openOptionsPage();
		} catch (ex) {
			console.error("lr_action.openSettings: runtime.openOptionsPage: %o", ex);
		}
		return await bapi.tabs.create({
			url: bapi.runtime.getURL("pages/settings.html"),
			openerTabId: tab && tab.id,
			windowId: tab && tab.windowId,
		});
	};

	return this;
}.call(lr_action || {});
