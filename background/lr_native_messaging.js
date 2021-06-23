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
	async function hello(capture, {backend} = {}) {
		if (backend == null || backend === "") {
			backend = lr_settings.getOption("export.methods.nativeMessaging.backend");
		}
		if (backend == null || backend === "") {
			throw new Error("Native messaging backend is not specified");
		}
		const connection = new LrNativeConnection(backend);
		try {
			const hello = await connection.send("hello", {
				formats: lr_export.getAvailableFormats(),
				version: bapi.runtime.getManifest().version,
			});
			if (typeof hello != 'object') {
				throw new Error('Response to "hello" is not an object describing capabilities')
			}
			return hello;
		} finally {
			connection.disconnect();
		}
	}

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
			if (typeof hello != 'object' || !hello.format || !hello.version) {
				throw new Error('Response to "hello" from native app must have "format" and "version" fields')
			}
			const {format, version, options} = hello;
			console.debug("lrNativeMessaging: %s: hello: %o",  backend, hello);
			const data = lr_export.format(capture, { ...hello, recursionLimit: 4 });
			return await connection.send("capture", {data, format, version, options});
		} finally {
			connection.disconnect();
		}
	}

	this.initSync = function () {
		lr_settings.registerGroup({
			name: "export.methods.nativeMessaging",
			title: "Browser native messaging communication channel",
			priority: 10,
		});
		/* Firefox-78 ESR does not support `nativeMessaging` in `optional_permissions`
		 * see [[https://bugzilla.mozilla.org/1630415]]
		 * "1630415 - make nativeMessaging an optional permission".
		 * Implemented in Firefox-87.
		 * Chromium-90 does not expose `chrome.runtime.connectNative`
		 * till extension reload.
		 */
		lr_settings.registerOption({
			name: "permissions.nativeMessaging",
			type: "permission",
			title: 'Permission: Exchange messages with other programs ("nativeMessaging")',
			version: "0.2",
			description: [
				"It is necessary to explicitly grant this permission",
				"if you decided to configure communication with Emacs",
				"using native messaging backend.",
				"Implementation of request on demand in problematic in this case.",
				"In Chrome you may need to reload the extension",
				"after granting this permission.",
			],
			parent: "export.methods.nativeMessaging",
		});
		lr_settings.registerOption({
			name: "export.methods.nativeMessaging.backend",
			parent: "export.methods.nativeMessaging",
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
	Object.assign(this, { hello });
	return this;
}.call(lr_native_messaging || {});
