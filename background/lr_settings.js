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

var lr_settings = lr_util.namespace("lr_settings", lr_settings, function() {
	this.NAME_SETTING = "settings.extensionName";
	this.EXTENSION_NAME = "LinkRemark";

	this.settingsMap = new Map();

	this.registerOption = function(details) {
		if (details == null) {
			console.error("lr_settings.registerOption called with argument " + details);
			return;
		}
		for (const property of ["name", "defaultValue", "version", "title", "description"]) {
			console.assert(
				details[property] !== undefined,
				`Settings option ${details.name} should define ${property}`);
		}
		this.settingsMap.set(details.name, details);
	};
	
	this.getCurrent = function() {
		return this.current;
	};

	this.register = function(rpc) {
		rpc.register("settings.descriptors", this.handleGetDescriptors);
		rpc.register("settings.update", this.handleUpdate);
	};

	this.getOption = function(name) {
		const current = this.current && this.current[name];
		if (current && !current.useDefault) {
			return current.value;
		}
		const descriptor = this.settingsMap.get(name);
		if (descriptor == null) {
			throw new Error(`Unknown setting ${name}`);
		}
		return descriptor.defaultValue;
	};

	this.changedListener = async function(changes, area) {
		console.debug("LR storage changed", area, changes);
		if (area !== "local") {
			return;
		}
		if (Object.prototype.hasOwnProperty.call(changes, "settings")) {
			await lr_settings.load();
		}
	};

	this.date = function() {
		return (new Date()).toISOString();
	};

	this.initSync = function() {
		this.version = bapi.runtime.getManifest().version;

		this.registerOption({
			name: this.NAME_SETTING,
			defaultValue: this.EXTENSION_NAME,
			title: "Name of extension this settings belong to",
			version: "0.1",
			description: [
				"Explicitly stored add-on name should catch attempts",
				"to load settings from backup created by another extension.",
				"Do not change this value",
			],
		});
		this.registerOption({
			name: "settings.version",
			defaultValue: this.version,
			title: "Version of extension when it was installed",
			version: "0.1",
			description: [
				"In future it might affect effective default values",
			],
		});
		this.registerOption({
			name: "settings.date",
			defaultValue: this.date(),
			title: "Date and time when settings were modified last time",
			version: "0.1",
			description: [
				"Created with hope that it will help to realize",
				"when settings backup file were created",
			],
		});
		this.registerOption({
			name: "settings.comment",
			defaultValue: null,
			title: "Some note to describe the state or last chages",
			version: "0.1",
			type: "text",
			description: [
				"Added purely for user convenience.",
				"Do not try to store here something important.",
			],
		});
	};

	this.load = async function() {
		const subset = await bapi.storage.local.get("settings");
		if (subset != null) {
			this.current = subset.settings;
		}
		return subset.settings;
	};

	this.initValues = function() {
		const result = Object.create(null);
		const names = [
			this.NAME_SETTING,
			"settings.version",
			"settings.date",
			"settings.comment",
		];
		const date = this.date();
		for (const property of names) {
			const value = this.getOption(property);
			if (value != null) {
				result[property] = { date, value, version: this.version };
			}
		}
		return result;
	};

	this.initAsync = async function() {
		try {
			let values = await this.load();
			if (values == null || Object.keys(values).length === 0) {
				values = lr_settings.initValues();
				await bapi.storage.local.set({ settings: values });
			}
			// FIXME write version comparator
			// and reject settings for newer versions of the extension
			this.current = values;
		} catch (ex) {
			console.error("LR: storage unavailable:", ex);
		}
	};

	this.getDescriptors = function() {
		return Array.from(this.settingsMap.values()).map(param => {
			const retval = Object.assign({}, param, { value: (this.current || {})[param.name] });
			if (lr_util.isFunction(retval.description)) {
				retval.description = retval.description();
			}
			return retval;
		}, this);
	};
	this.handleGetDescriptors = this.getDescriptors.bind(this);

	this.assertName = function(valueObject) {
		if (valueObject == null || valueObject.value != this.EXTENSION_NAME) {
			throw new Error(`${this.NAME_SETTING} must be ${this.EXTENSION_NAME}`);
		}
		return true;
	};

	this.update = async function(params) {
		const [obj, replace] = params;
		let needCommit = false;
		const update = {};
		const deleted = [];
		if (obj == null) {
			return {}
		}

		if (replace) {
			this.assertName(obj[this.NAME_SETTING]);
		}
		for (const [name, updateFields] of Object.entries(obj)) {
			if (!this.settingsMap.has(name)) {
				throw new Error("Unknown setting: " + name);
			}
			if (name === this.NAME_SETTING) {
				this.assertName(obj[this.NAME_SETTING]);
			}
			if (updateFields != null) {
				const current = this.current[name];
				const {value, useDefault} = updateFields;
				if (current != null && current.value == value && current.useDefault == useDefault) {
					if (replace && (
						current.date != updateFields.date || current.version != updateFields.version
					)) {
						update[name] = updateFields;
						needCommit = true;
					}
					continue;
				}
				needCommit = true;
				update[name] = replace ? updateFields : {
					value, useDefault, date: this.date(), version: this.version
				};
			} else {
				if (lr_util.has(this.current, name)) {
					deleted.push(name);
					needCommit = true;
				}
			}
		}
		if (!needCommit) {
			return {};
		}
		if (replace) {
			await bapi.storage.local.set({ settings: obj });
			for (const name of deleted) {
				update[name] = null;
			}
			return update;
		} else {
			const newSettings = Object.assign({}, this.current, update);
			for (const name of deleted) {
				update[name] = null;
				delete newSettings[name];
			}
			await bapi.storage.local.set({ settings: newSettings });
			return update;
		}
	};
	this.handleUpdate = this.update.bind(this);

	return this;
});
