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

var lr_rpc_commands = lr_util.namespace(lr_rpc_commands, function lr_rpc_commands() {
	var lr_rpc_commands = this;
	/* Polyfill for Firefox-78 ESR that does not allow to close preview from its JS script */
	this.closeTab = function (_args, port) {
		const id = port.tab && port.tab.id;
		if (id == null || ! port.url.startsWith(bapi.runtime.getURL("/"))) {
			console.error("Request from foreign page to close tab: %o %o", id, port.url);
			throw new Error("Request to close foreign tab refused")
		}
		bapi.tabs.remove(id);
	}
	return this;
});
