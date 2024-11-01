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

var gDescriptors = false;

class LrPermissionControl {
	constructor(name, isHost) {
		this.name = name;
		this.host = isHost;
		this.permission = this.name.substring(12);
	}
	render() {
		this.checkbox = E('input', { type: 'checkbox', name: this.name });
		const hidden = [];
		if (this.host) {
			this.hostInput = E('input', {
				type: 'hidden',
				name: this.name + ".host",
				value: "t",
			});
			hidden.push(this.hostInput);
		}
		this.progress = E('span', { className: 'invisible' }, " Updating...");
		this.error = E('span', { className: 'invisible error'}, " Failed");
		const label = E('label', null, this.checkbox, "Allowed");
		return E('div', null, label, ...hidden, this.progress, this.error);
	}
	mapStateToProps(state) {
		return state && state.permissions && state.permissions[this.permission];
	}
	updateProps(props) {
		if (!this.checkbox) { // has not rendered yet
			return;
		}
		this.checkbox.checked = props && props.state;
		const errorText = props && props.requests && props.requests.filter(r => r.error != null)
			.map(r => String(r.error)).join(", ");
		if (errorText) {
			this.error.classList.remove("invisible");
			this.error.innerText = " " + errorText;
		} else {
			this.error.classList.add("invisible");
			this.error.innerText = " Failed";
		}
		if (props && props.requests && props.requests.some(r => !r.error)) {
			this.progress.classList.remove("invisible");
		} else {
			this.progress.classList.add("invisible");
		}
	}
}

function getDescriptionParagraphs(property) {
	let text = property && property.description;
	if (!text) {
		return [];
	}
	if (Array.isArray(text)) {
		text = text.reduce(
			(a, b) => (b === "" || b === "\n") ? ( a + "\n" + b) : (a + " " + b));
	}
	const paragraphs = text.split("\n");
	return paragraphs.map(p => E("p", null, p));
}

function formatDetails(property) {
	const pars = getDescriptionParagraphs(property);

	const pName = E("p", null, E("code", null, property.name));
	if (!pars || !(pars.length > 0)) {
		return pName;
	}
	return E("details", { open: "true" }, pName, ...pars);
}

function applyValueObject(form, property) {
	const real = form["real." + property.name];
	const realValue = property.value != null ? property.value.value : false;
	switch (getType(property)) {
		case "boolean":
			real.checked = realValue;
			break;
		case "text":
			real.textContent = realValue || "";
			break;
		default:
			real.value = realValue || "";
			break;
	}
	try {
		const def = form[property.name + ".useDefault"];
		const div = document.getElementById("container." + property.name);
		if (def.checked) {
			div.classList.add("defaultValue");
			div.classList.remove("userValue");
		} else {
			div.classList.add("userValue");
			div.classList.remove("defaultValue");
		}
	} catch (ex) {
		console.error("applyValueObject %o: %o", property, ex);
	}
}

function formatInput(property, options) {
	const isDefault = options && options.isDefault;
	const inputName = isDefault ? property.name + ".default" : "real." + property.name;
	switch (getType(property)) {
		case "boolean":
			const checkbox = E("input", {
				type: "checkbox",
				name: inputName,
			});
			if (isDefault) {
				// readOnly is not supported for non-text inputs
				checkbox.disabled = true;
				checkbox.checked = !!property.defaultValue;
			}
			return E("label", null, checkbox, "Active");
			break;
		case "text":
			// - limitedWidth to allow user and default fields have independent width.
			// - cols to allow resizing by user behind right screen edge.
			const textarea = E("textarea", {
				name: inputName, className: "limitedWidth", cols: 132
			});
			const content = (isDefault ? property.defaultValue : property.value?.value) ?? "";
			if (isDefault) {
				textarea.readOnly = true;
				textarea.textContent = content;
			}
			textarea.rows = Math.max(
				isDefault? 1 : 3,
				Math.min(10, content.split?.("\n")?.length));
			return isDefault ? E('div', { className: "scroll" }, textarea) : textarea;
			break;
		default:
			const input = E("input", { name: inputName });
			if (isDefault) {
				input.readOnly = true;
				input.value = property.defaultValue != null ? property.defaultValue : "";
			}
			return input;
			break;
	}
}

function formatDefault(property) {
	const isText = getType(property) === "text";
	const divDefault = E("div", isText ? null : { className: "flexLineContainer" });
	divDefault.classList.add("defaultInputContainer");
	divDefault.append(E("input", {
		type: "hidden",
		name: property.name + ".date",
		value: property.value && property.value.date,
	}));
	divDefault.append(E("input", {
		type: "hidden",
		name: property.name + ".version",
		value: property.value && property.value.version,
	}));
	const label = E("label", { className: "defaultLabel" });
	const checkbox = E("input", {
		type: "checkbox", name: property.name + ".useDefault",
	});
	checkbox.checked = !property.value || property.value.useDefault;
	label.append(checkbox);
	label.append("Use default:" + " ");
	divDefault.append(label);
	const input = formatInput(property, { isDefault: true });
	input.classList.add("defaultInput");
	divDefault.append(input);
	return divDefault;
}

function getType(property) {
	if (property.type) {
		return property.type;
	}
	if (typeof property.defaultValue === "boolean")
		return "boolean";
	return "string";
}

function formatPermission(property) {
	const control = new LrPermissionControl(property.name, property.host);
	const dom = control.render();
	// HTML elements should be already created to properly updateProps.
	lrEventSources.stateStore.registerComponent(
		control,
		control.mapStateToProps.bind(control));
	return dom;
}

function formatPropertyInputs(property) {
	const type = getType(property);
	if (type === "permission") {
		return formatPermission(property);
	}
	const isText = type === "text";
	const input = formatInput(property);
	input.classList.add("userInput");
	const inputContainer = E("div", { className: "userInputContainer", }, input);
	inputContainer.classList.add(isText ? "scroll" : "flexLineContainer");
	const divDefault = formatDefault(property);
	const attrs = { id: "container." + property.name, };
	if (!isText) {
		attrs.className = "flexLineContainer";
	}
	return E("div", attrs, inputContainer, divDefault);
}

async function lrInputChanged(e) {
	try {
		const form = document.getElementById("formDescriptors");
		const targetName = e.target.name;
		if (targetName.startsWith("permissions.")) {
			const name = targetName.substring(12);
			const isHost = form[targetName + ".host"];
			const permObj = isHost ? { origins: [ name ] } : { permissions: [ name ] };
			const state = e.target.checked;
			// Reset to original state till permission change event,
			e.target.checked = !e.target.checked;
			lrEventSources.permissionEvents.change(state, permObj);
			return;
		}
		const real = targetName.startsWith("real.");
		const name = real ? targetName.substring(5) : targetName.replace(/\.[^.]+$/, "");
		if (real) {
			form[name + ".useDefault"].checked = false;
		}
		const change = makeValueDescriptor(form, name);
		const update = await lr_common.sendMessage("settings.update", [{ [name]: change }]);
		console.debug(change, update);
		for (const [name, valueObject] of Object.entries(update || {})) {
			const property = gDescriptors.get(name);
			property.value = valueObject;
			applyValueObject(form, property);
		};
	} catch (ex) {
		console.error(ex);
		const divReport = document.getElementById("fileReport");
		divReport.append(E("p", { className: "error" }, `${e.target.name}: ${ex}`));
	}
}

async function renderDescriptors() {
	const form = document.getElementById("formDescriptors");
	const descriptors = await lr_common.sendMessage("settings.descriptors");
	gDescriptors = new Map(descriptors.map(p => [p.name, p]));
	for (const property of descriptors) {
		const isText = getType(property) === "text";
		const attrs = isText ? { className: "textParameter" } : null;
		const div = E("div", attrs);
		if ("defaultValue" in property || "type" in property) {
			div.append(E("h3", null, property.title));
			const divInputs = formatPropertyInputs(property)
			if (isText) {
				divInputs.classList.add("scrollContainer");
			}
			div.append(divInputs);
			div.append(formatDetails(property));
			form.append(div);
		} else {
			form.append(E("h2", null, property.title));
			if (property.description) {
				form.append(E("div", null, ...getDescriptionParagraphs(property)));
			}
		}
	}
	for (const property of descriptors) {
		if ("defaultValue" in property && property.type !== 'permission') {
			applyValueObject(form, property);
		}
	}
	form.addEventListener("change", lrInputChanged, false);
}


async function lrOnFileLoad() {
	const fileLoad = document.getElementById("fileLoad");
	const divReport = document.getElementById("fileReport");
	divReport.innerText = "";
	for (let f of fileLoad.files) {
		try {
			const settings = JSON.parse(await f.text());
			const update = await lr_common.sendMessage("settings.update", [settings, true ]);
			divReport.append(E(
				"p", null,
				`Backup restored from ${f.name}`
			));
			window.location.reload();
		} catch (ex) {
			divReport.append(E(
				"p", { className: "error"},
				`${f.name}: ${ex}`
			));
			throw ex;
		}
	}
}

function makeValueDescriptor(form, name) {
	const input = form["real." + name];
	const value = input.type === "checkbox" ? input.checked : input.value;
	const version = form[name + ".version"].value;
	const date = form[name + ".date"].value;
	const useDefault = form[name + ".useDefault"].checked;
	if (!value && useDefault && !date && !version) {
		return null;
	}
	return { value, version, date, useDefault };
}

function lrGetFormState() {
	const form = document.getElementById("formDescriptors");
	const formData = new FormData(form);
	const result = Object.create(null);
	for (const input of form.querySelectorAll("input, textarea")) {
		const namePrefixed = input.name;
		if (!namePrefixed.startsWith("real.")) {
			continue;
		}
		const name = namePrefixed.substring(5);
		const valueDescriptor = makeValueDescriptor(form, name);
		if (valueDescriptor) {
			result[name] = valueDescriptor;
		}
	}
	return result;
}

var gObjectUrl;

async function lrMakeBackup(e) {
	const fileSave = document.getElementById("fileSave");
	const divReport = document.getElementById("fileReport");
	divReport.innerText = "";
	const dt = (new Date()).toISOString().replace(/:|\..*$/g, "");
	const fileName = `linkremark-backup-${dt}.txt`
	try {
		if (gObjectUrl) {
			URL.revokeObjectURL(gObjectUrl);
			gObjectUrl = null;
		}
		fileSave.setAttribute("download", fileName);
		const content = JSON.stringify(lrGetFormState(), null, "  ") + "\n";
		console.debug(content);
		const blob = new Blob([content], { type: "text/plain" });
		gObjectUrl = URL.createObjectURL(blob);
		fileSave.href = gObjectUrl;
		divReport.append(E("p", null, `Saved file: ${fileName}`));
	} catch (ex) {
		divReport.append(E(
			"p", { className: "error"},
			`${fileName}: ${ex}`
		));
		throw ex;
		e.preventDefault();
	}
}

function initLoadSave() {
	const fileLoad = document.getElementById("fileLoad");
	fileLoad.addEventListener('change', lrOnFileLoad, false);
	const fileSave = document.getElementById("fileSave");
	fileSave.addEventListener("click", lrMakeBackup, false);
}

function lrInitEventSources() {
	const permissionEvents = new LrPermissionsEvents();
	const stateStore = new LrStateStore((state = {}, action) => {
		const { permissions } = state;
		const updated = lrPermissionsReducer(permissions, action);
		return permissions === updated ? state : { ...state, permissions: updated };
	});
	stateStore.registerComponent(permissionEvents, null, dispatch => permissionEvents.subscribe(dispatch));
	return { permissionEvents, stateStore };
}

function lrpListenForReload() {
	/* `runtime.reload()` breaks options page in Chromium-95.
	 * Due to https://crbug.com/936415 and https://crbug.com/935904
	 * extension in Chromium must be reloaded after `permissions.request()`
	 * to get access to `runtime.connectNative()`.
	 * Add workarounds to force reloading of the options page.
	 */
	bapi.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
		if (msg && msg.method === "extension.reload") {
			console.log("Reloading preferences page due to request from background page");
			setTimeout(() => window.location.reload(), 200);
			sendResponse({ result: true });
		}
	});
}

var lrEventSources = lrInitEventSources();
renderDescriptors();
initLoadSave();
lrpSetupHelpHandler();
lrpListenForReload();
