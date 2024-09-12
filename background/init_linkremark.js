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

"use strict";
/*
 * This file should be loaded before other background pages.
 * It is intended only for simple and really reliable stuff.
 */

console.debug("LR: loading...");

var gLrLoadErrorCount = 0;
function lrIncrementLoadErrorCount() {
	++gLrLoadErrorCount;
}
function lrRemoveLoadErrorCount() {
	globalThis.removeEventListener("error", lrIncrementLoadErrorCount);
	globalThis.removeEventListener("unhandledrejection", lrIncrementLoadErrorCount);
}
try {
	/* It catches only errors in synchronous code run on add-on startup.
	 * Errors from event listeners such as `browserAction.onClicked`
	 * are invisible for this handler (Chromium-129). */
	globalThis.addEventListener("error", lrIncrementLoadErrorCount);
	/* This handler is invoked for exceptions in `async` functions
	 * passed to `addListener`. */
	globalThis.addEventListener("unhandledrejection", lrIncrementLoadErrorCount);
} catch (ex) {
	Promise.reject(ex);
}

var bapi;
var lr_action;
var lr_actionlock;
var lr_clipboard;
var lr_export;
var lr_native_export;
var lr_notify;
var lr_scripting;
var lr_settings;
var lr_util;

!function lrNotifyLoading() {
	// Make load errors visible to users.
	// `bapi` has not initialized yet, so use `chrome` as more portable.
	// The expression is supposed to suppress linter warning at addons.mozilla.org.
	const action = chrome["browserAction" in chrome ? "browserAction" : "action"];
	if (action.setBadgeText) {
		action.setBadgeText({ text: "…"});
	}
	if (action.setBadgeBackgroundColor) {
		action.setBadgeBackgroundColor({ color: [159, 0, 0, 159] });
	}
	var name = chrome.runtime.getManifest().short_name || "";
	action.setTitle({ title: name + " Loading..." });
}();
