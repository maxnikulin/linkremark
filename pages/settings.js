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

var gDescriptors = false;

function E(tagName, attrs, ...children) {
	const e = document.createElement(tagName);
	for (const [attr, value] of Object.entries(attrs || {})) {
		if (attr === "className") {
			e.className = value || "";
		} else {
			e.setAttribute(attr, value != null ? value : "");
		}
	}
	for (const child of children) {
		e.append(child);
	}
	return e;
}

function getDescriptionParagraphs(property) {
	let text = property && property.description;
	if (!text) {
		return [];
	}
	if (Array.isArray(text)) {
		text = text.join(" ");
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
			const textarea = E("textarea", { name: inputName });
			textarea.readOnly = isDefault;
			return textarea;
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
	const attrs = getType(property) === "text" ? null : { className: "flexLineContainer" };
	const divDefault = E("div", attrs);
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
	const label = E("label", { className: "flexFixed" });
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

function formatPropertyInputs(property) {
	const isText = getType(property) === "text";
	const input = formatInput(property);
	input.classList.add("userInput");
	const inputContainer = E("div", { className: "userInputContainer", }, input);
	if (!isText) {
		inputContainer.classList.add("flexLineContainer");
	}
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
		const real = targetName.startsWith("real.");
		const name = real ? targetName.substring(5) : targetName.replace(/\.[^.]+$/, "");
		if (real) {
			form[name + ".useDefault"].checked = false;
		}
		const change = makeValueDescriptor(form, name);
		const update = await lrSendMessage("settings.update", [{ [name]: change }]);
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
	const descriptors = await lrSendMessage("settings.descriptors");
	gDescriptors = new Map(descriptors.map(p => [p.name, p]));
	for (const property of descriptors) {
		const div = document.createElement("div");
		if ("defaultValue" in property) {
			div.append(E("h3", null, property.title));
			div.append(formatPropertyInputs(property));
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
		if ("defaultValue" in property) {
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
			const update = await lrSendMessage("settings.update", [settings, true ]);
			divReport.append(E(
				"p", null,
				`Backup resored from ${f.name}`
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

renderDescriptors();
initLoadSave();
