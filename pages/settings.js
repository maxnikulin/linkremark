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

function E(tagName, attrs, child) {
	const e = document.createElement(tagName);
	for (const [attr, value] of Object.entries(attrs || {})) {
		if (attr === "className") {
			e.className = value || "";
		} else {
			e.setAttribute(attr, value != null ? value : "");
		}
	}
	if (child) {
		e.append(child);
	}
	return e;
}

function formatDetails(property) {
	let text = property && property.description;
	if (!text) {
		return "\n";
	}
	if (Array.isArray(text)) {
		text = text.join(" ");
	}
	const paragraphs = text.split("\n");
	const details = E("details", { open: "true" });

	const pName = E("p");
	pName.append(E("code", null, property.name));
	details.append(pName);

	for (const p of paragraphs) {
		details.append(E("p", null, p));
	}
	return details;
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
}

function formatDefault(property) {
	const span = document.createElement("span");
	const label = E("label");
	const checkbox = E("input", {
		type: "checkbox", name: property.name + ".useDefault",
	});
	checkbox.checked = !property.value || property.value.useDefault;
	label.append(checkbox);
	label.append("Use default:" + " ");
	span.append(label);
	span.append(E("input", {
		readonly: true,
		name: property.name + ".default",
		value: property.defaultValue != null ? property.defaultValue : "",
	}));
	return span;
}

function getType(property) {
	if (property.type) {
		return property.type;
	}
	if (typeof property.defaultValue === "boolean")
		return "boolean";
	return "string";
}

function formatInput(property) {
	const div = E("div");
	const inputName = "real." + property.name;
	switch (getType(property)) {
		case "boolean":
			const label = E("label");
			label.append(E("input", { type: "checkbox", name: inputName }));
			label.append(document.createTextNode("Value"));
			div.append(label);
			break;
		case "text":
			const textDiv = E("div");
			textDiv.append(E("textarea", { name: inputName }));
			div.append(textDiv);
			break;
		default:
			div.append(E("input", { name: inputName }));
			break;
	}
	div.append(E("input", {
		type: "hidden",
		name: property.name + ".date",
		value: property.value && property.value.date,
	}));
	div.append(E("input", {
		type: "hidden",
		name: property.name + ".version",
		value: property.value && property.value.version,
	}));
	div.append(formatDefault(property));
	return div;
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
		div.append(E("h3", null, property.title));
		div.append(formatInput(property));
		div.append(formatDetails(property));
		form.append(div);
	}
	for (const property of descriptors) {
		applyValueObject(form, property);
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
