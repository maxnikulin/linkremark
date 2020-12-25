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

var lr_clipboard = function() {
	async function lrCopyToClipboard(capture, options = null) {
		let { tab, format, version, usePreview, ...formatterOptions } = options || {};
		if (tab == null) {
			throw new Error('"tab" option object is required for clipboard export');
		}
		if (!format) {
			format = lr_settings.getOption("export.methods.clipboard.formatterType");
		}
		if (!version) {
			version = lr_settings.getOption("export.methods.clipboard.formatterVersion");
		}

		const note = lr_export.format(capture, format, version, formatterOptions);
		if (!note) {
			throw new Error(`Formatter ${format}-${version} returned empty result`);
		}
		if (usePreview == null) {
			usePreview = lr_settings.getOption("export.methods.clipboard.usePreview");
		}
		const strategyOptions = { tab, usePreview };
		capture.transport = { format, method: "clipboard" };
		return await lrClipboardAny(capture, strategyOptions);
	}

	async function lrLaunchOrgProtocolHandler(capture, options = {}) {
		let { tab, format, template, version, usePreview, transport, ...formatterOptions } = options || {};
		if (tab == null) {
			throw new Error('"tab" option object is required for org-protocol export');
		}
		if (!format) {
			format = lr_settings.getOption("export.methods.orgProtocol.formatterType");
		}
		if (!version) {
			version = lr_settings.getOption("export.methods.orgProtocol.formatterVersion");
		}

		const note = lr_export.format(capture, format, version, formatterOptions);
		if (!note) {
			throw new Error(`Formatter ${format}-${version} returned empty result`);
		}
		if (usePreview == null) {
			usePreview = lr_settings.getOption("export.methods.orgProtocol.usePreview");
		}
		if (transport == null || transport.clipboardForBody == null) {
			transport = { clipboardForBody: lr_settings.getOption("export.methods.orgProtocol.clipboardForBody") };
		}
		if (template == null) {
			template = lr_settings.getOption("export.methods.orgProtocol.template") || "";
		}
		const handlerPopupSuppressed = lr_settings.getOption(
			"export.methods.orgProtocol.handlerPopupSuppressed");
		capture.transport = {
			...transport, format,
			method: "org-protocol",
			handlerPopupSuppressed,
			url: lrOrgProtocol.makeUrl({
				template,
				url: capture[format].url,
				body: transport.clipboardForBody? "": capture[format].body,
				title: capture[format].title,
			}),
		};
		const strategyOptions = { tab, usePreview, skipBackground: true };
		return await lrClipboardAny(capture, strategyOptions);
	}

	/* Does not work for privileged content.
	 * However usually allows to avoid flashing new tab.
	 */
	async function lrClipboardContentScript(capture, options) {
		const { usePreview, tab } = options || {}
		if (usePreview) {
			return false;
		}
		const tabId = tab != null ? tab.id : null;
		if (!(tabId >= 0)) {
			throw new Error("lrClipboardContentScript: invalid tabId");
		}
		return await gLrAsyncScript.exec(tabId, 0, { file: "content_scripts/clipboard.js" });
	}

	/* Does not work in chromium-87, "write-clipboard" or "writeClipboard" permissions
	 * does not help.
	 *     navigator.permissions.query({ name: 'clipboard-write' })
	 * reports "granted".
	 * chromium-browser: DOMException: Document is not focused.
	 *
	 * For Firefox it looks like the best method if clipboard permission
	 * is requested.
	 * TODO visual feedback in Firefox.
	 */
	async function lrClipboardWriteBackground(capture, options) {
		const { usePreview, skipBackground } = options || {}
		if (usePreview || skipBackground) {
			return false;
		}
		const format = capture.transport && capture.transport.format;
		if (!format) {
			throw new Error("Unknown format for clipboard: " + format);
		}
		let content = capture[format];
		if (content == null) {
			throw new Error("No content provided for clipboard format " + format);
		}
		if (content.body) {
			content = content.title + "\n" + content.body;
		}
		const text = typeof content === "string" ? content : JSON.stringify(content, null, "  ");
		// It seems that result value is unspecified.
		// On failure the promise is rejected.
		await navigator.clipboard.writeText(text);
		return true;
	}

	async function lrClipboardUsePreview(capture, options) {
		const { tab, usePreview } = options || {}
		const params = usePreview ? {} : { action: "launch" };
		return await lr_action.openPreview(tab, params);
	}

	async function lrClipboardAny(capture, options) {
		for (let method of [lrClipboardWriteBackground, lrClipboardContentScript, lrClipboardUsePreview]) {
			try {
				const result = await method(capture, options);
				if (result) {
					return true;
				} else {
					console.error(`lrClipboard: ${method.name} has not succeeded`);
				}
			} catch (ex) {
				console.error(method && method.name, ex);
			}
		}
		return false;
	}

	this.initSync = function() {
		lr_export.registerMethod("clipboard", lrCopyToClipboard);
		lr_export.registerMethod("org-protocol", lrLaunchOrgProtocolHandler);

		lr_settings.registerOption({
			name: "export.methods.clipboard.usePreview",
			defaultValue: true,
			version: "0.1",
			title: "Open preview tab with capture result for clipboard",
			description: [
				"Set to false to copy without extra action on the preview page.",
				"Preview tab could be still required to capture privileged",
				"pages, but it will be promptly closed.",
			],
		});
		lr_settings.registerOption({
			name: "export.methods.clipboard.formatterType",
			defaultValue: "org",
			version: "0.1",
			title: "Formatter applied to create note from captured metadata for clipboard",
			description: [
				"Currently the only meaningful option is \"org\".",
				"I do not think that JSON generated by \"object\"",
				"is suitable for any convenient workflow.",
			],
		});
		lr_settings.registerOption({
			name: "export.methods.clipboard.formatterVersion",
			defaultValue: "0.1",
			version: "0.1",
			title: "Version of formatter for clipboard",
			description: [
				"Formatters will likely be modified, and this option",
				"is intended to fix appearance of captured notes",
			],
		});
		lr_settings.registerOption({
			name: "export.methods.orgProtocol.usePreview",
			defaultValue: true,
			version: "0.1",
			title: "Open preview tab with capture result for org-protocol",
			description: [
				"Set to false to launch external protocol handler",
				"without extra action on the preview page.",
				"Preview tab could be still required to capture privileged",
				"pages, but it will be promptly closed.",
			],
		});
		lr_settings.registerOption({
			name: "export.methods.orgProtocol.handlerPopupSuppressed",
			defaultValue: false,
			version: "0.1",
			title: "Browser popup for external handler suppressed",
			description: [
				"Turn this on if preview for org protocol is disabled",
				"and browser does not show popup on every org-protocol link.",
				"It could be tricky to suppress that dialog in Chrome.",
			],
		});
		lr_settings.registerOption({
			name: "export.methods.orgProtocol.formatterType",
			defaultValue: "org",
			version: "0.1",
			title: "Formatter for org-protocol handler",
			description: [
				"Currently the only meaningful option is \"org\".",
				"I do not think that JSON generated by \"object\"",
				"is suitable for any convenient workflow.",
			],
		});
		lr_settings.registerOption({
			name: "export.methods.orgProtocol.formatterVersion",
			defaultValue: "0.1",
			version: "0.1",
			title: "Version of formatter for org-capture",
			description: [
				"Formatters will likely be modified, and this option",
				"is intended to fix appearance of captured notes",
			],
		});
		lr_settings.registerOption({
			name: "export.methods.orgProtocol.template",
			defaultValue: "",
			version: "0.1",
			title: "Template name configured in Org mode Capture",
			description: [
				"Emacs configuration should define capture template something like",
				"\n\"* %:description\n%?%:initial\"",
			],
		});
		lr_settings.registerOption({
			name: "export.methods.orgProtocol.clipboardForBody",
			defaultValue: false,
			version: "0.1",
			title: "Copy note text to clipboard instead of setting \"body\" parameter",
			description: [
				"Unsure if lenthy captures could really cause a trouble",
				"with external protocol handlers. Anyway creating of",
				"naitve messaging backend could be more reliable options",
				"Template example",
				"\n\"* %:description\n%?%(org-get-x-clipboard 'CLIPBOARD)\"",
			],
		});
	};
	return this;
}.call(lr_clipboard || {});
