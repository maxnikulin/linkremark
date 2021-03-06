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

// Is not used in other scripts. Global is just for debug convenience.
var gLrRpcServer;

var lrInstallMenu = lr_util.notFatal(function() {
	bapi.runtime.onInstalled.addListener(lr_action.createMenu);
});

var lrAddListeners = lr_util.notFatal(function() {
	bapi.contextMenus.onClicked.addListener(lr_action.contextMenuListener);
	bapi.browserAction.onClicked.addListener(lr_action.browserActionListener);
	bapi.commands.onCommand.addListener(lr_action.commandListener);
	bapi.storage.onChanged.addListener(lr_settings.changedListener);
});

var lrResetLoadingState = lr_util.notFatal(function() {
	if (gLrLoadErrorCount === 0) {
		bapi.browserAction.setBadgeText({ text: "" });
		bapi.browserAction.setTitle({ title: bapi.i18n.getMessage("cmdPageRemark") });
	} else {
		bapi.browserAction.setBadgeText({ text: "\\!/" });
		bapi.browserAction.setTitle({ title: name + " Error" }); // TODO i18n
	}
});

function lrMainSync() {
	lr_settings.initSync();
	lr_export.initSync();
	lr_native_messaging.initSync();
	lr_clipboard.initSync();
	lrAddListeners();
	lrInstallMenu();
	gLrRpcServer = new LrRpcServer();
	bapi.runtime.onMessage.addListener(gLrRpcServer.listener);
}

async function lrMainAsync() {
	await lr_settings.initAsync();
	await lr_export.initAsync();
	gLrRpcServer.register("cache.getLast", gLrResultCache.handleLast);
	gLrRpcServer.register("cache.getLastResult", gLrResultCache.handleLastResult);
	gLrRpcServer.register("cache.getTargetElement", gLrResultCache.handleTargetElement);
	gLrRpcServer.register("polyfill.closeTab", lr_rpc_commands.closeTab);
	gLrRpcServer.register("nativeMessaging.hello", lr_native_messaging.hello);
	gLrRpcServer.register("export.process", lr_export.processMessage.bind(lr_export));
	gLrRpcServer.register("export.format", lr_export.formatMessage.bind(lr_export));
	gLrRpcServer.register("export.availableFormats", lr_export.getAvailableFormats.bind(lr_export));
	gLrAsyncScript = new LrAsyncScript();
	gLrAsyncScript.register(gLrRpcServer);
	lr_settings.register(gLrRpcServer);
	lrResetLoadingState();
	console.debug("LR: async init completed");
}

lrMainSync();
lrMainAsync();
console.debug("LR: sync init completed");
