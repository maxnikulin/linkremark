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
/*
 * This file should be loaded before other background pages.
 * It is intended only for simple and really reliable stuff.
 */

console.debug("LR: loading...");

var gLrLoadErrorCount = 0;
try {
	/* It catches only errors in synchronous code run on add-on startup.
	 * Errors from event listeners such as `browserAction.onClicked`
	 * are invisible for this handler. */
	window.addEventListener("error", function(...args) {
		++gLrLoadErrorCount;
	});
} catch (ex) {
	console.error("LR error while trying to set error listener", ex);
}

var bapi;
var lr_action;
var lr_clipboard;
var lr_export;
var lr_native_messaging;
var lr_settings;
var lr_util;
var gLrAsyncScript;

!function lrNotifyLoading() {
	// `bapi` has not initialized yet, so use `chrome` as more portable
	chrome.browserAction.setBadgeText({ text: "…"});
	chrome.browserAction.setBadgeBackgroundColor({ color: [159, 0, 0, 159] });
	var name = chrome.runtime.getManifest().short_name || "";
	chrome.browserAction.setTitle({ title: name + " Loading..." });
}();
