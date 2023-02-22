/*
   Copyright (C) 2023 Max Nikulin

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

function lrOffscreenClipboard(msg, _sender, sendResponse) {
	if (msg?.method !== "offscreen.clipboard") {
		return undefined;
	}
	const id = msg?.id;
	try {
		const text = msg.params[0];
		const result = lr_common.copyUsingEvent(text);
		sendResponse({
			id,
			result: result !== true ? result : "offscreen.document.execCommand.oncopy",
		});
	} catch (ex) {
		console.error(ex);
		sendResponse({ id, error: lr_common.errorToObject(ex) });
	}
}

chrome.runtime.onMessage.addListener(lrOffscreenClipboard);
