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

function lrpSetupSettingsHandler(id="settings") {
	function lrpOpenSettings(ev) {
		function lrpOnOpenOptionsPageError(ex) {
			console.error("lrpOpenSettings: runtime.openOptionsPage: %o", ex);
			// Next time use default browser action to open link target.
			ev.target.removeEventListener("click", lrpOpenSettings);
		}
		try {
			bapi.runtime.openOptionsPage().catch(lrpOnOpenOptionsPageError);
			ev.preventDefault();
		} catch (ex) {
			lrpOnOpenOptionsPageError(ex);
		}
	}
	const element = document.getElementById(id);
	element.addEventListener("click", lrpOpenSettings);
}

function lrpSetupHelpHandler(id="help") {
	function lrpHelp(ev) {
		function lrpOnHelpError(ex) {
			console.error("lrpHelp: error: %o", ex);
			ev.target.removeEventListener("click", lrpHelp);
		}
		try {
			lr_common.sendMessage("action.help").catch(lrpOnHelpError);
			ev.preventDefault();
			ev.stopImmediatePropagation();
		} catch (ex) {
			lrpOnHelpError(ex);
		}
	}

	const element = document.getElementById(id);
	element.addEventListener("click", lrpHelp);
}

