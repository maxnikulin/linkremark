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

var lr_native_export = lr_util.namespace(lr_native_export, function lr_native_export() {
	var lr_native_export = this;
	const TIMEOUT = 3000;

	class LrNativeAppNotConfiguredError extends Error {
		get name() { return Object.getPrototypeOf(this).constructor.name; }
	}

	const permissions = [ "nativeMessaging" ];

	async function hello(params) {
		return await lr_executor.run(
			withConnectionHello, params,
			function lrNativeAppHello(params, properties, executor) {
				return properties.hello;
			});
	}

	async function lrSendToNative(capture, params, executor) {
		const { error, tab, ...connectionParams } = params || {};
		try {
			return await withConnectionHello(
				connectionParams,
				async function _lrSendToNative(params, properties, executor) {
					const { backend, connection, hello } = properties;
					if (!hello.format || !hello.version) {
						throw new Error('Response to "hello" from native app must have "format" and "version" fields')
					}
					const {format, version, options} = hello;
					console.debug("lrNativeMessaging: %s: hello: %o",  backend, hello);
					const data = executor.step(
						function formatForNativeApp(capture, options, executor) {
							return lr_export.format(capture, options, executor);
						},
						capture, { ...hello, recursionLimit: 4 } /*, executor implicit argument */);
					capture.transport.method = "native-messaging";
					let result = await executor.step(
						async function sendToNativeApp(object) {
							return await connection.send("capture", object);
						},
						{data, error, format, version, options});
					if (typeof result === 'boolean') {
						result = { preview: !result }
					}
					return {
						...result,
						previewTab: tab,
						previewParams: null,
					};
				},
				executor);
		} catch (ex) {
			// Format to org if it is something wrong with the backend.
			executor.step(
				{ errorAction: lr_executor.IGNORE_ERROR },
				function formatFallback(capture, executor) {
					return lr_export.format(
						capture,
						{ format: "org", version: lr_export.ORG_PROTOCOL_VERSION, recursionLimit: 4 },
						executor);
				},
				capture /*, executor implicit argument */);
			throw ex;
		}
	}

	function _getBackend(params) {
		let backend = params && params.backend;
		if (backend === undefined) {
			backend = lr_settings.getOption("export.methods.nativeMessaging.backend");
		}
		if (!backend) {
			throw new LrNativeAppNotConfiguredError("Native messaging backend is not specified");
		}
		return backend;
	}

	async function _hasPermissions() {
		return await bapi.permissions.contains({ permissions });
	}

	async function withConnectionHello(params, func, executor) {
		const timeout = (params && params.timeout) || TIMEOUT;
		const backend = _getBackend(params);
		if (!bapi.runtime.connectNative) {
			if (!await _hasPermissions()) {
				throw new Error("Request for nativeMessaging permission was rejected");
			}
			/* Due to https://crbug.com/936415 and https://crbug.com/935904
			 * extension in Chromium must be reloaded after `permissions.request()`
			 * to get access to `runtime.connectNative()`.
			 * `runtime.reload()` breaks options page in Chromium-95.
			 * Add workarounds to force reloading of the options page.
			 */
			console.log("Reloading extension with hope to get access to runtime.connectNative, https://crbug.com/935904");
			lr_common.sendMessage("extension.reload");
			await new Promise(resolve => setTimeout(resolve, 100));
			bapi.runtime.reload();
		}
		const connection = new LrNativeConnection(backend, executor.ctx.signal);
		try {
			const hello = await executor.step(
				{ result: true, timeout },
				async function nativeAppHello() {
					return await connection.send("hello", {
						formats: lr_export.getAvailableFormats(),
						version: bapi.runtime.getManifest().version,
					});
			});
			if (!hello || typeof hello !== 'object') {
				throw new Error('Response to "hello" is not an key-value Object');
			}
			return await executor.step(func, params, { backend, connection, hello });
		} finally {
			connection.disconnect();
		}
	}

	function _queryArrayFromObject(obj, queryArray) {
		const queue = obj != null ? [ obj ] : [];
		while (queue.length > 0) {
			const element = queue.pop();
			if (element.urls) {
				const id = lr_common.getId();
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

	async function _queryMentions(queryArray, params, executor) {
		if (!await _hasPermissions()) {
			return { response: "NO_PERMISSIONS" };
		}
		return await withConnectionHello(params,
			async function _doQueryMentions(params, properties, executor) {
				const { backend, connection, hello } = properties;
				if (
					!hello.capabilities || !hello.capabilities.indexOf
					|| !(hello.capabilities.indexOf("urlMentions") >= 0)
				) {
					return { response: "UNSUPPORTED", hello };
				}
				const response = new Map();
				let error;
				for (const query of queryArray) {
					try {
						const { variants, id } = query;
						const mentions = await connection.send("linkremark.urlMentions", { variants })
						if (mentions && mentions.total > 0) {
							response.set(id, mentions);
						}
					} catch (ex) {
						if (error) {
							// TODO report to executor
							console.error("lr_native_export._queryMentions: error: %o %o", ex, variants);
						} else {
							error = ex;
						}
					}
				}
				if (response.size === 0) {
					if (error) {
						throw error;
					}
					return { response: "NO_MENTIONS", hello };
				} else if (error) {
					console.error("lr_native_export._queryMentions: error: %o", ex);
				}
				return { response, hello };
			},
			executor);
	}

	async function mentions(obj, params, executor) {
		const queryArray = [];
		_queryArrayFromObject(obj, queryArray);
		if (!(queryArray.length > 0)) {
			return { mentions: "NO_URLS" };
		}
		const result = await _queryMentions(queryArray, params, executor);
		if (result == null) {
			return { mentions: "INTERNAL_ERROR" };
		} else if (typeof result.response === "string") {
			return { mentions: result.response, hello: result.hello };
		}
		const mentions = _resultMapToObject(obj, result.response) || "NO_MENTIONS";
		return { mentions, hello: result.hello };
	}

	async function mentionsEndpoint(params) {
		return await lr_executor.run(
			async function checkKnownUrlsEndpoint(params, executor) {
				const { backend, variants } = params && params[0] || {};
				const id = lr_common.getId();
				const result = await lr_native_export._queryMentions(
					[ { id, variants } ], { backend }, executor);
				const { response } = result;
				const mentions = typeof response === "string" ? response : response.get(id);
				return { hello: result.hello, mentions };
			},
			params);
	}

	async function visitEndpoint(args) {
		const [ query, params ] = args;
		const backend = _getBackend(params);
		const timeout = AbortSignal.timeout(params.timeout ?? lr_native_export.TIMEOUT);
		const connection = new LrNativeConnection(backend, timeout);
		try {
			return await connection.send("linkremark.visit", query);
		} finally {
			connection.disconnect();
		}
	}

	function initSync() {
		lr_settings.registerGroup({
			name: "export.methods.nativeMessaging",
			title: "Browser native messaging communication channel",
			priority: 10,
		});
		lr_settings.registerOption({
			name: "permissions.nativeMessaging",
			type: "permission",
			title: 'Permission: Exchange messages with other programs ("nativeMessaging")',
			version: "0.2",
			description: [
				"Requested on demand when \"nativeMessaging\"",
				"is configured as the export method to communicate with Emacs",
				"without global org-protocol handler.",
				"In Chrome first capture may fail due to necessity to reload the extension",
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
				"Native messaging application is the recommended way to invoke emacs-client.",
				"It is a bit safer than desktop-wide org-protocol: scheme handler.",
				"Visit project page https://github.com/maxnikulin/linkremark/",
				"to get a simple lr_emacsclient python backend",
				"or to install more advanced bURL app.",
				"\n",
				"See https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging",
				"or https://developer.chrome.com/docs/apps/nativeMessaging",
				"for details how to configure native messaging application.",
				"\n",
				"You can create your own trusted application yourself,",
				"in a minimal variant it does not need much of code.",
			],
		});

		lr_export.registerMethod({
			method: "native-messaging",
			handler: lrSendToNative,
			permissions,
		});
	};
	Object.assign(this, {
		LrNativeAppNotConfiguredError,
		TIMEOUT,
		hello, withConnectionHello, mentions, mentionsEndpoint, visitEndpoint,
		initSync,
		_queryMentions,
	});
	return this;
});
