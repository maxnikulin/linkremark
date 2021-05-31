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

var lr_export = function() {
	this.formatMap = new Map();
	this.methodMap = new Map();

	this.initAsync = async function() {
		lr_settings.registerGroup({
			name: "export",
			title: "Communication Channel",
			priority: 50,
		});
		lr_settings.registerOption({
			name: "export.method",
			defaultValue: "clipboard",
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
	};


	this.initSync = function() {
		lr_export.registerFormat({
			format: "org",
			version: "0.2",
			formatter: function lrFormatOrg(result, _options) {
				if (result != null && result.org != null) {
					return result.org;
				}
				if (result == null || result.object == null) {
					throw new Error('No result in "object" format');
				}
				const frame = result.object[0];
				result.org = lr_format_org(result.object);
				return result.org;
			},
		});

		this.registerFormat({
			format: "object",
			version: "0.2",
			formatter: function lrFormatJson(result, _options) {
				if (result == null || result.object == null) {
					throw new Error('No result in "object" format');
				}
				return { body: result.object };
			},
		});
	};

	this.process = async function(result, options = null) {
		let {method, ...otherOptions} = options || {};
		if (method == null) {
			method = lr_settings.getOption("export.method");
		}
		const handler = this.methodMap.get(method);
		if (handler == null) {
			throw new Error(`lr_export: Export method ${method} unknown`);
		}
		return handler(result, otherOptions);
	};

	/** Register `formatter(resultObj, options) => { body, title, url}`
	 * that is called when
	 * `lr_export.format(resultObj, { format, version, options, recursionLimit })`
	 * is invoked. Notice that `recursionLimit` field is mandatory.
	 * @argument options: Object { name: String setting_name }
	 * `setting_name` in `options` descriptor is used to get current setting value
	 * effective if no such option is passed explicitly.
	 */
	this.registerFormat = function({format, version, formatter, options, override}) {
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

	this.registerMethod = function(method, handler, override = false) {
		lr_util.assertAsyncFunction(
			handler, 'export: registerMethod "handler" argument must be callable');
		if (!override && this.methodMap.has(method)) {
			throw new Error(`Export method ${method} already registered`);
		}
		this.methodMap.set(method, handler);
	};

	this.getAvailableMethods = function() {
		return [...this.methodMap.keys()];
	};

	this.getAvailableFormats = function() {
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
					for (const [option_name, setting_name] of Object.entries(info.options)) {
						defaultValues[option_name] = lr_settings.getOption(setting_name);
					}
				}
			}
		}
		if (!(result.length > 0)) {
			throw new Error("No export formats has been registered as available so far");
		}
		return result;
	};

	this.format = function(capture, formatOptions) {
		const { format, version, options } = formatOptions;
		let { recursionLimit} = formatOptions;
		if (!(recursionLimit-- > 0)) {
			throw new Error("Recursion limit exceeded or not specified");
		}
		const versionMap = this.formatMap.get(format);
		const versionInfo = versionMap && versionMap.get(version);
		if (versionInfo == null) {
			throw new Error(`Unknown format ${format}-${version}`);
		}
		const defaultOptions = {};
		for (const [option_name, setting_name] of Object.entries(versionInfo.options || {})) {
			if (options == null || options[optionName] === undefined) {
				defaultOptions[option_name] = lr_settings.getOption(setting_name);
			}
		}
		return versionInfo.formatter(capture, { ...defaultOptions, ...(options || {}), recursionLimit });
	};

	return this;
}.call(lr_export || {});
