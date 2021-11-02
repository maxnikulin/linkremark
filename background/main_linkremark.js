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

var gLrRpcStore;
// Is not used in other scripts. Global is just for debug convenience.
var gLrAddonRpc;

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
	lr_native_export.initSync();
	lr_clipboard.initSync();
	lrAddListeners();
	try {
		lr_action.createMenu();
	} catch (ex) {
		++gLrLoadErrorCount;
		console.log("lrMainSync: createMenu: %o", ex);
	}
	gLrRpcStore = new LrRpcStore();
	gLrAddonRpc = new LrAddonRpc();
	bapi.runtime.onMessage.addListener(gLrAddonRpc.listener);
	bapi.runtime.onConnect.addListener(gLrAddonRpc.onConnect);
}

async function lrMainAsync() {
	await lr_settings.initAsync();
	await lr_export.initAsync();
	gLrAddonRpc.register("store.getResult", gLrRpcStore.handleResult);
	gLrAddonRpc.register("store.getCapture", gLrRpcStore.handleCapture);
	gLrAddonRpc.register("store.getTargetElement", gLrRpcStore.handleTargetElement);
	gLrAddonRpc.register("polyfill.closeTab", lr_rpc_commands.closeTab);
	gLrAddonRpc.register("nativeMessaging.hello", lr_native_export.hello);
	gLrAddonRpc.register("nativeMessaging.mentions", lr_native_export.mentionsEndpoint);
	gLrAddonRpc.register("nativeMessaging.visit", lr_native_export.visitEndpoint);
	gLrAddonRpc.register("export.process", lr_export.processMessage.bind(lr_export));
	gLrAddonRpc.register("export.format", lr_export.formatMessage.bind(lr_export));
	gLrAddonRpc.register("export.availableFormats", lr_export.getAvailableFormats.bind(lr_export));
	gLrAddonRpc.register("action.captureTab", lr_action.captureCurrentTabEndpoint);
	gLrAddonRpc.register("action.help", lr_action.openHelpEndpoint);
	gLrAsyncScript = new LrAsyncScript();
	gLrAsyncScript.register(gLrAddonRpc);
	lr_settings.register(gLrAddonRpc);
	try {
		lr_actionlock.register(gLrAddonRpc);
	} catch (ex) {
		console.error("lr_actionlock: %o", ex);
		++gLrLoadErrorCount;
	}
	lrResetLoadingState();
	console.debug("LR: async init completed");
}

lrMainSync();
lrMainAsync();
console.debug("LR: sync init completed");
