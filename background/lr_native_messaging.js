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

var lr_native_messaging = function() {
	async function lrSendToNative(capture, {backend} = {}) {
		if (backend === undefined) {
			backend = lr_settings.getOption("export.methods.nativeMessaging.backend");
		}
		if (!backend) {
			throw new Error("Native messaging backend is not specified");
		}
		const connection = new LrNativeConnection(backend);
		try {
			const hello = await connection.send("hello", {
				formats: lr_export.getAvailableFormats(),
				version: bapi.runtime.getManifest().version,
			});
			const {format, version} = hello;
			console.debug("lrNativeMessaging: %s: hello: %o",  backend, hello);
			const data = lr_export.format(capture, format, version);
			return await connection.send("capture", {data, format, version});
		} finally {
			connection.disconnect();
		}
	}

	this.initSync = function () {
		lr_settings.registerOption({
			name: "export.methods.nativeMessaging.backend",
			defaultValue: null,
			version: "0.1",
			title: "Name of native messaging backend application",
			description: [
				"Native messaging application could be used to invoke other programs,",
				"e.g. emacs-client, to avoid setting up of org-protocol",
				"handler for security or other reasons.",
				"It could be used to experiment with custom formatting of captured data",
				"\n",
				"Only example application is included to the sources of the extension",
				"\n",
				"See https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging",
				"or https://developer.chrome.com/docs/apps/nativeMessaging",
				"for details how to configure native messaging application"
			],
		});

		lr_export.registerMethod("native-messaging", lrSendToNative);
	};
	return this;
}.call(lr_native_messaging || {});
