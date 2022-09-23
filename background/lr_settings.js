/*
   Copyright (C) 2020-2022 Max Nikulin

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

var lr_settings = lr_util.namespace(lr_settings, function lr_settings() {
	var lr_settings = this;
	this.NAME_SETTING = "settings.extensionName";
	this.EXTENSION_NAME = "LinkRemark";

	this.settingsMap = new Map();

	this.registerOption = function(details) {
		if (details == null) {
			console.error(
				"lr_settings.registerOption called with invalid argument " + String(details));
			return;
		}
		for (const property of ["name", "defaultValue", "version", "title", "description"]) {
			if (details.type === "permission" && property === "defaultValue") {
				continue;
			}
			console.assert(
				details[property] !== undefined,
				`Settings option ${details.name} should define ${property}`);
		}
		if (details.name.startsWith("permissions.")) {
			const perm = details.name.substring(12);
			const optional = bapi.runtime.getManifest().optional_permissions;
			if (!optional || !(optional.indexOf(perm) >= 0)) {
				console.log(
					"lr_settings.registerOption: skip optional permission %s as disabled for this browser.",
					perm);
				return;
			}
		}
		this.settingsMap.set(details.name, details);
	};

	this.registerGroup = function(details) {
		if (details == null) {
			console.error("lr_settings.registerOption called with argument " + details);
			return;
		}
		/* description is optional */
		for (const property of ["name", "title"]) {
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
		rpc.register("settings.get", this.handleGet);
	};

	/// Classify if it is a real setting or something else (group, permission)
	this._isSetting = function(descriptor) {
		return descriptor && "defaultValue" in descriptor;
	};

	this.getOption = function(name) {
		const current = this.current && this.current[name];
		if (current && !current.useDefault) {
			return current.value;
		}
		const descriptor = this.settingsMap.get(name);
		if (!this._isSetting(descriptor)) {
			throw new Error(`Unknown setting ${name}`);
		}
		return descriptor.defaultValue;
	};

	this.getSettings = function(names) {
		if (names == null) {
			const result = {};
			for (const [key, descriptor] of this.settingsMap) {
				if (this._isSetting(descriptor)) {
					result[key] = this.getOption(key);
				}
			}
			return result;
		} else if (typeof names === "string") {
			return this.getOption(names);
		} else if (Array.isArray(names)) {
			const result = {};
			for (const item of names) {
				result[item] = this.getOption(item);
			}
			return result;
		}
		throw new TypeError("Unsupported argument type");
	};

	this.handleGet = this.getSettings.bind(this);

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

		this.registerGroup({
			name: "internal",
			title: "Internal Settings",
			description: [
				"Settings in this group should not be modified by users.",
				"They are exposed for troubleshooting.",
			],
			priority: 0,
		});
		this.registerGroup({
			name: "informational",
			title: "Informational Options",
			priority: 100,
		});
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
			parent: "internal",
		});
		this.registerOption({
			name: "settings.version",
			defaultValue: this.version,
			title: "Version of extension when it was installed",
			version: "0.1",
			description: [
				"In future it might affect effective default values",
			],
			parent: "internal",
		});
		this.registerOption({
			name: "settings.comment",
			defaultValue: null,
			title: "Some note to describe the state or last changes",
			version: "0.1",
			type: "text",
			description: [
				"Added purely for user convenience.",
				"Do not try to store here something important.",
			],
			parent: "informational",
		});
		this.registerOption({
			name: "settings.date",
			defaultValue: this.date(),
			title: "Date and time when settings were initialized",
			version: "0.1",
			description: [
				"Created with hope that it will help to realize",
				"when settings backup file were created",
			],
			parent: "internal",
		});

		this.registerGroup({
			name: "misc",
			title: "Miscellaneous",
			priority: 4,
		});
		this.registerOption({
			name: "permissions.tabs",
			title: 'Permission: access browser tabs ("tabs")',
			version: "0.2",
			description: [
				"Requested on demand.",
				"Relevant to capture of multiple tabs at once:",
				"it may be a group of tabs in Chrome",
				"or several highlighted (selected) tabs.",
				"Allows to get titles and URLs more reliably.",
				"For regular pages the same info may be obtained",
				"when access to all web sites (<all_urls>) is granted.",
				"Without this permission some tabs may be completely opaque",
				"for the extension: internal pages, privileged sites,",
				"PDF files when context menu is used.",
				"Revoke to block add-on access to titles and URLs",
				"of tabs other than the currently active one.",
				"Delay may happen in Chrome unless",
				"\"Allow this extension to read and change all your data on websites you visit\"",
				"for this extension is set to \"On all sites\".",
			],
			type: "permission",
			parent: "misc",
		});
		this.registerOption({
			name: "permissions.tabGroups",
			title: 'Permission: tab group property ("tabGroups")',
			version: "0.4",
			description: [
				"When tab group is captured (Chrome) use group name",
				"for capture heading title.",
			],
			type: "permission",
			parent: "misc",
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
		const { LrMultiMap } = lr_multimap;
		const settingsMap = this.settingsMap;
		const ROOT_NODE = Symbol.for("LrRootNode");
		function getParentId(descriptor) {
			const par = descriptor.parent;
			if (par == null) {
				return ROOT_NODE;
			}
			if (!settingsMap.has(par)) {
				console.warn("lr_settings.getDescriptors: unknown parent %o", par);
				return ROOT_NODE;
			}
			return par;
		}

		const settingsTree = new LrMultiMap();
		for (const descriptor of settingsMap.values()) {
			settingsTree.set(getParentId(descriptor), descriptor);
		}

		function* deepFirstSortedTree(tree, cmp) {
			const unseen = new Set(tree.values());
			const queue = [];
			function pushChildren(queue, nodeId) {
				const children = nodeId && tree.get(nodeId);
				if (!children) {
					return;
				}
				let next = Array.from(children);
				if (cmp) {
					next.sort(cmp);
				}
				// reverse to preserve insertion order if priority is not specified
				queue.push(...next.reverse());
			}
			unseen.delete(tree.get(ROOT_NODE));
			pushChildren(queue, ROOT_NODE);
			while (unseen.size > 0) {
				while (queue.length > 0) {
					const e = queue.pop();
					if (unseen.delete(e)) {
						yield e;
						pushChildren(queue, e.name);
					}
				}
				// take first unset element if there is any
				for (const cyclic of unseen) {
					console.warn("LR: cycle in a tree: %o", cyclic);
					queue.push(cyclic);
					break;
				}
			}
		}

		function priorityGreater(a, b) {
			const pa = a && a.priority || 0;
			const pb = b && b.priority || 0;
			return pb - pa;
		}

		return Array.from(deepFirstSortedTree(settingsTree, priorityGreater), param => {
			const retval = Object.assign({}, param)
			if ("defaultValue" in param) {
				Object.assign(retval, { value: (this.current || {})[param.name] });
			}
			if (lr_util.isFunction(retval.description)) {
				try {
					retval.description = retval.description();
				} catch (ex) {
					console.error("lr_settings.getDescriptors: failed to eval description for %o: %o",
						param.name, ex);
					retval.description = "";
				}
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

	// TODO Separate into model part and async part actual updating the storage.
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
						break;
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
		if (!needCommit && replace) {
			for (const descriptor of this.settingsMap.values()) {
				if (!this._isSetting(descriptor)) {
					continue;
				}
				const { name } = descriptor;
				if (name in obj) {
					continue;
				}
				if (name in this.current) {
					needCommit = true;
					break;
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
