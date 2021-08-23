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

var lr_native_messaging = function() {
	const TIMEOUT = 3000;

	async function hello(params) {
		const { connection, hello } = await connectionWithHello(params);
		connection.disconnect();
		return hello;
	}

	async function lrSendToNative(capture, params) {
		const { dryRun, ...connectionParams } = params || {};
		const { backend, connection, hello } = await connectionWithHello(connectionParams);
		try {
			if (!hello.format || !hello.version) {
				throw new Error('Response to "hello" from native app must have "format" and "version" fields')
			}
			const {format, version, options} = hello;
			console.debug("lrNativeMessaging: %s: hello: %o",  backend, hello);
			const data = lr_export.format(capture, { ...hello, recursionLimit: 4 });
			capture.transport.method = "native-messaging";
			if (dryRun) {
				return true;
			}
			return await connection.send("capture", {data, format, version, options});
		} finally {
			connection.disconnect();
		}
	}

	function _getBackend(params) {
		let backend = params && params.backend;
		if (backend === undefined) {
			backend = lr_settings.getOption("export.methods.nativeMessaging.backend");
		}
		if (!backend) {
			throw new Error("Native messaging backend is not specified");
		}
		return backend;
	}

	/** Wrap the call with try-finally to ensure that connection is closed.
	 *
	 * There is no way to ensure resource release in JS. Even generators
	 * may be destroyed without executing of `finally`.
	 */
	async function connectionWithHello(params) {
		const timeout = params && params.timeout;
		const backend = _getBackend(params);
		const connection = new LrNativeConnection(backend);
		try {
			const hello = await Promise.race([
				connection.send("hello", {
					formats: lr_export.getAvailableFormats(),
					version: bapi.runtime.getManifest().version,
				}),
				new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeout || TIMEOUT)),
			]);
			if (!hello || typeof hello !== 'object') {
				throw new Error('Response to "hello" is not an key-value Object');
			}
			return { backend, connection, hello };
		} catch (ex) {
			connection.disconnect();
			throw ex;
		}
	}

	function _queryArrayFromObject(obj, queryArray) {
		const queue = obj != null ? [ obj ] : [];
		while (queue.length > 0) {
			const element = queue.pop();
			if (element.urls) {
				const id = bapiGetId();
				element.id = id;
				queryArray.push({ id, variants: element.urls });
				continue;
			}
			if (element.children) {
				queue.push(...element.children);
			}
		}
	}

	function _resultMapToObject(obj, resultMap) {
		const queue = [ { item: obj } ];
		while (queue.length > 0) {
			const { item, post } = queue.pop();
			if (!post) {
				const id = item.id;
				if (id != null) {
					const mentions = resultMap.get(id);
					if (mentions != null && (mentions.total > 0 || mentions.url != null)) {
						item.children = [ mentions ];
					} else {
						item.drop = true;
					}
				} else if (item.children && item.children.length > 0) {
					queue.push({ item, post: true });
					queue.push(...item.children.map(it => ({ item: it })));
				} else {
					item.drop = true;
				}
			} else {
				if (item.children) {
					item.children = item.children.filter(it => !it.drop);
				}
				if (!item.children || !(item.children.length > 0)) {
					item.drop = true;
				}
			}
		}
		return !obj.drop ? obj : null;
	}

	async function _queryMentions(queryArray, params) {
		const hasPermissions = await bapi.permissions.contains(
			{ permissions: [ "nativeMessaging" ] });
		if (!hasPermissions) {
			return { response: "NO_PERMISSIONS" };
		}
		const { backend, connection, hello } = await connectionWithHello(params);
		try {
			if (
				!hello.capabilities || !hello.capabilities.indexOf
				|| !(hello.capabilities.indexOf("urlMentions") >= 0)
			) {
				return { response: "UNSUPPORTED", hello };
			}
			const response = new Map();
			for (const query of queryArray) {
				const { variants, id } = query;
				const mentions = await connection.send("linkremark.urlMentions", { variants })
				if (mentions && mentions.total > 0) {
					response.set(id, mentions);
				}
			}
			if (response.size === 0) {
				return { response: "NO_MENTIONS", hello };
			}
			return { response, hello };
		} finally {
			connection.disconnect();
		}
	}

	async function mentions(obj, params) {
		const queryArray = [];
		_queryArrayFromObject(obj, queryArray);
		if (!(queryArray.length > 0)) {
			return { mentions: "NO_URLS" };
		}
		const result = await _queryMentions(queryArray, params);
		if (result == null) {
			return { mentions: "INTERNAL_ERROR" };
		} else if (typeof result.response === "string") {
			return { mentions: result.response, hello: result.hello };
		}
		const mentions = _resultMapToObject(obj, result.response) || "NO_MENTIONS";
		return { mentions, hello: result.hello };
	}

	async function mentionsEndpoint(params) {
		const { backend, variants } = params[0];
		const id = bapiGetId();
		const result = await _queryMentions([ { id, variants } ], { backend });
		const { response } = result;
		const mentions = typeof response === "string" ? response : response.get(id);
		return { hello: result.hello, mentions };
	}

	async function visitEndpoint(args) {
		const [ query, params ] = args;
		const timeout = params && params.timeout || TIMEOUT;
		const backend = _getBackend(params);
		const connection = new LrNativeConnection(backend);
		try {
			return await Promise.race([
				connection.send("linkremark.visit", query),
				new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeout)),
			]);
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

		lr_export.registerMethod({
			method: "native-messaging",
			handler: lrSendToNative,
			permissions: function lrNativeMessagingPermissions() {
				const permission = "nativeMessaging";
				const optional = bapi.runtime.getManifest().optional_permissions;
				const hasOptional = optional && optional.indexOf(permission) >= 0;
				return hasOptional ? [ permission ] : null;
			},
		});
	};
	Object.assign(this, { hello, connectionWithHello, mentions, mentionsEndpoint, visitEndpoint });
	return this;
}.call(lr_native_messaging || {});
