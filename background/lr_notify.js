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

"use strict";

var lr_notify = lr_util.namespace(lr_notify, function lr_notify() {
	var lr_notify = this;
	const notifyNothing = 0;
	const notifyProgress = 1;
	const notifySuccess = 2;
	const notifyError = 3;
	const notifyWarning = 4;

	var state = {
		get NOTHING() {
			return notifyNothing;
		},
		get PROGRESS() {
			return notifyProgress;
		},
		get SUCCESS() {
			return notifySuccess;
		},
		get ERROR() {
			return notifyError;
		},
		get WARNING() {
			return notifyWarning;
		},
	};

	const colorValue = 159;

	var notify = lr_util.notFatal(async function lrNotify({state, tabId, title}) {
		let color = [ colorValue, colorValue, 0, colorValue ];
		let text = "?";
		const name = bapi.runtime.getManifest().short_name;
		switch (state) {
			case notifyNothing:
				text = "";
				break;
			case notifyProgress:
				text = "···";
				if (title == null) {
					title = `${name}: in progress...`; // TODO i18n
				}
				break;
			case notifySuccess:
				text = "+"
				color = [ 0, colorValue, 0, colorValue ];
				break;
			case notifyError:
				text = "\\!/";
				color = [ colorValue, 0, 0, colorValue ];
				if (title == null) {
					title = `${name} failed`; // TODO i18n
				}
				break;
			case notifyWarning:
				text = "\\!/";
				if (title == null) {
					title = `${name}: some problems`; // TODO i18n
				}
				break;
			default:
				console.warn("lr_notify.notify: invalid state %o", state);
		}
		// TODO await
		bapi.browserAction.setBadgeBackgroundColor({ tabId, color });
		bapi.browserAction.setBadgeText({ tabId, text });
		if (title == null) {
			title = bapi.i18n.getMessage("cmdPageRemark");
		}
		bapi.browserAction.setTitle({ tabId, title });
	});

	Object.assign(this, {
		state, notify,
	});

	return this;
});
