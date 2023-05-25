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

/// `lr_export` is a global object rather than a namespace of free functions.
var lr_export = lr_util.namespace(lr_export, function lr_export() {
	var lr_export = this;
	this.ORG_PROTOCOL_VERSION = "0.2";
	this.formatMap = new Map();
	this.methodMap = new Map();

	function initSync() {
		lr_settings.registerGroup({
			name: "export",
			title: "Communication Channel",
			priority: 50,
		});
		lr_settings.registerOption({
			name: "export.method",
			defaultValue: "clipboard", // TODO might be unavailable
			version: "0.1",
			title: "Method how to pass capture to desktop environment",
			description: () => {
				const methods = lr_export.getAvailableMethods().map(x => `"${x}"`).join(" ");
				return [
					"Available options:",
					methods
				].join(" ");
			},
			parent: "export",
		});
		lr_export.registerFormat({
			format: "org",
			version: "0.2",
			options: {
				templateType: "export.methods.orgProtocol.templateType",
			},
			formatter: function lrFormatOrg(capture, options, executor) {
				const src = lr_export.findFormat(capture, {
					format: lr_tabframe.FORMAT,
					version: lr_tabframe.VERSION,
				});
				if (src == null) {
					throw new Error('No result in "object" format');
				}
				const result = lr_format_org.format(src.body, options, executor);
				result.src = src.id;
				return result;
			},
		});

		this.registerFormat({
			format: lr_tabframe.FORMAT,
			version: lr_tabframe.VERSION,
			formatter: function lrFormatJson(capture, _options) {
				// format "object" should be handled by generic function
				throw new Error('Format "object" is unavailable');
			},
		});

		lr_export.registerFormat({
			format: "org-protocol",
			version: lr_export.ORG_PROTOCOL_VERSION,
			options: {
				format: "export.methods.orgProtocol.formatterType",
				version: "export.methods.orgProtocol.formatterVersion",
				template: "export.methods.orgProtocol.template",
				clipboardForBody: "export.methods.orgProtocol.clipboardForBody",
				detectUnconfigured: "export.methods.orgProtocol.detectUnconfigured",
				baseURL: "export.methods.orgProtocol.captureBaseURL",
			},
			formatter: function lrFormatOrgProtocol(result, options, executor) {
				const { template, clipboardForBody, baseURL, ...formatOptions } = options;
				const src = lr_export.format(result, formatOptions, executor);
				const { url, body, title } = src;
				const arg = {
					template,
					url, title
				};
				const retval = { title, src: src.id };
				const text = typeof body === "string" ? body : JSON.stringify(body);
				if (clipboardForBody) {
					retval.body = text;
				} else {
					arg.body = text;
				}
				if (baseURL) {
					retval.url = lr_org_protocol.makeUrl(arg, baseURL);
				} else {
					retval.url = lr_org_protocol.makeUrl(arg);
				}
				return retval;
			},
		});
	};

	async function process(result, options = null, executor) {
		let {method, ...otherOptions} = options || {};
		if (method == null) {
			method = lr_settings.getOption("export.method");
		}
		const descriptor = this.methodMap.get(method);
		if (descriptor == null) {
			throw new Error(`lr_export: Export method ${method} unknown`);
		}
		return await descriptor.handler(result, otherOptions, executor);
	};

	async function requestPermissions() {
		if (!lr_settings.isReady()) {
			/* User action context is lost in Firefox causing rejection
			 * or `permissions.request
			 * https://bugzilla.mozilla.org/1398833
			 * "chrome.permissions.request needs to be called directly from input handler,
			 * making it impossible to check for permissions first"
			 */
			await lr_settings.wait();
		}
		if (!lr_settings.getOption("misc.permissionsOnDemand")) {
			// TODO Interactive warning on failure that requests options
			return;
		}
		const method = lr_settings.getOption("export.method");
		const descriptor = this.methodMap.get(method);
		if (descriptor == null) {
			throw new Error(`lr_export.requestPermissions: Export method ${method} unknown`);
		}
		let { permissions } = descriptor;
		if (lr_util.isFunction(permissions)) {
			permissions = permissions(lr_settings);
		}
		if (permissions) {
			// For logging purposes only
			let result;
			try {
				result = await bapi.permissions.request({ permissions });
			} catch (ex) {
				// Avoid Firefox error due to lack of user action context
				// while settings are loaded.
				result = await bapi.permissions.contains({ permissions });
				if (!result) {
					throw ex;
				}
			}
			return {
				permissions,
				result,
			};
		}
		return true;
	};

	// Chromium only, has no value in Firefox-115 ESR.
	async function checkUserGesture() {
		try {
			return await bapi.permissions.request({});
		} catch (ex) {
			const reUserGesture = new RegExp(
				"(?:must be called during a user gesture"
				+ "|may only be called from a user input handler)$");
			const message = ex?.message;
			if (typeof message !== "string" || !reUserGesture.test(message)) {
				Promise.reject(ex);
			}
		}
		return false;
	}

	// For RPC endpoints
	function _restoreMeta(capture) {
		for (const key of Object.keys(capture.formats)) {
			const projection = capture.formats[key];
			if (projection.format === "object" && projection.body) {
				projection.body = lr_meta.objectToMeta(projection.body);
			}
		}
		return capture;
	};

	// RPC endpoint called from preview page, so converts Object to LrMeta.
	async function processMessage([ capture, options ]) {
		return await lr_executor.run(
			async function exportRpcEndpoint(capture, options, executor) {
				try {
					await executor.acquireLock("Export");
				} catch (ex) {
					if (
						typeof lr_actionlock !== undefined
						&& ex instanceof lr_actionlock.LrActionLockCancelledError
					) {
						throw ex;
					} else {
						executor.addError(new LrWarning("Action lock problem", { cause: ex }));
					}
				}
				if (capture == null) {
					throw new Error("No capture data");
				}
				const meta = executor.step(_restoreMeta, capture);
				return await executor.step(
					async function runExporter(meta, options, executor) {
						return lr_export.process(meta, options, executor);
					},
					meta, options /*, executor implicit argument */);
			},
			capture, options /*, executor implicit argument */);
	}

	/** Register `formatter(resultObj, options) => { body, title, url}`
	 * that is called when
	 * `lr_export.format(resultObj, { format, version, options, recursionLimit })`
	 * is invoked. Notice that `recursionLimit` field is mandatory.
	 * @argument options: Object { name: String settingName }
	 * `settingName` in `options` descriptor is used to get current setting value
	 * effective if no such option is passed explicitly.
	 */
	function registerFormat({format, version, formatter, options, override}) {
		lr_util.assertFunction(
			formatter, 'registerFormat "formatter" argument must be callable');
		let versionMap = this.formatMap.get(format);
		if (versionMap == null) {
			versionMap = new Map();
			this.formatMap.set(format, versionMap);
		}
		if (!override && versionMap.has(version)) {
			throw new Error(`Formatter already registered for ${format}-${version}`);
		}
		versionMap.set(version, { formatter, options });
	};

	function registerMethod(options) {
		const { method } = options;
		lr_util.assertAsyncFunction(
			options.handler, 'export: registerMethod "handler" argument must be callable');
		if (!options.override && this.methodMap.has(method)) {
			throw new Error(`Export method ${method} already registered`);
		}
		this.methodMap.set(method, options);
	};

	function getAvailableMethods() {
		return [...this.methodMap.keys()];
	};

	function getAvailableFormats() {
		const result = [];
		for (const [format, versionMap] of this.formatMap.entries()) {
			if (!(versionMap && versionMap.size > 0)) {
				continue;
			}
			for (const [version, info] of versionMap) {
				const versionInfo = { format, version };
				result.push(versionInfo);
				if (info.options) {
					const defaultValues = {};
					versionInfo.options = defaultValues;
					for (const [optionName, settingName] of Object.entries(info.options)) {
						defaultValues[optionName] = lr_settings.getOption(settingName);
					}
				}
			}
		}
		if (!(result.length > 0)) {
			throw new Error("No export formats has been registered as available so far");
		}
		return result;
	};

	function format(capture, formatOptions, executor) {
		const { format, version } = formatOptions;
		let { recursionLimit} = formatOptions;
		if (!(recursionLimit-- > 0)) {
			throw new Error("Recursion limit exceeded or not specified");
		}
		const versionMap = this.formatMap.get(format);
		const versionInfo = versionMap && versionMap.get(version);
		if (versionInfo == null) {
			throw new Error(`Unknown format ${format}-${version}`);
		}
		const options = versionInfo.options && {};
		if (options) {
			const overrides = formatOptions.options;
			for (const [optionName, settingName] of Object.entries(versionInfo.options)) {
				options[optionName] = overrides && optionName in overrides ?
					overrides[optionName] :
					lr_settings.getOption(settingName);
			}
		}

		const ready = lr_export.findFormat(capture, { format, version, options });
		const result = ready || versionInfo.formatter(capture, { ...options, recursionLimit }, executor);
		result.id = result.id || lr_common.getId();
		const resultOptions = result.options || options;
		if (resultOptions) {
			result.options = resultOptions;
		}
		result.format = format;
		result.version = version;
		capture.formats[result.id] = result;
		capture.transport.captureId = result.id;
		return result;
	};

	function formatMessage(args) {
		return lr_executor.run(
			function formatRpcEndpoint(args, executor) {
				if (args == null) {
					throw new TypeError("Internal error, [capture, options] argument expected");
				}
				const [ capture, options ] = args;
				const meta = executor.step(_restoreMeta, capture);
				lr_export.format(meta, { ...options, recursionLimit: 5 }, executor);
				return meta;
			},
			args  /*, executor implicit argument */);
	};

	function findFormat(capture, { format, version, options }) {
		const optionsJson = JSON.stringify(options || {});
		for (
			let projection, { captureId } = capture.transport;
			(projection = captureId && capture.formats[captureId]) != null;
			captureId = projection.src
		) {
			if (format !== projection.format || version !== projection.version) {
				continue;
			}
			const captureOptionsJson = JSON.stringify(projection.options || {});
			// TODO deep equal
			if (optionsJson === captureOptionsJson) {
				return projection;
			}
		}
		return null;
	};

	Object.assign(this, {
		checkUserGesture,
		findFormat,
		format,
		formatMessage,
		getAvailableFormats,
		getAvailableMethods,
		initSync,
		process,
		processMessage,
		registerFormat,
		registerMethod,
		requestPermissions,
		internal: { _restoreMeta },
	});

	return this;
});
