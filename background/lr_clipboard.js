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

var lr_clipboard = lr_util.namespace(lr_clipboard, function lr_clipboard() {
	var lr_clipboard = this;

	async function lrCopyToClipboard(capture, options = null, executor) {
		let { tab, format, version, usePreview, error, ...formatterOptions } = options || {};
		if (tab == null) {
			throw new Error('"tab" option object is required for clipboard export');
		}
		if (!format) {
			format = lr_settings.getOption("export.methods.clipboard.formatterType");
		}
		if (!version) {
			version = lr_settings.getOption("export.methods.clipboard.formatterVersion");
		}

		const note = executor.step(
			function formatForClipboard(capture, options, executor) {
				return lr_export.format(capture, options, executor);
			},
			capture,
			{ format, version, options: formatterOptions, recursionLimit: 4 },
			/* executor implicit argument */);
		if (!note) {
			throw new Error(`Formatter ${format}-${version} returned empty result`);
		}
		if (usePreview == null) {
			usePreview = lr_settings.getOption("export.methods.clipboard.usePreview");
		}
		capture.transport.method = "clipboard";
		if (error || usePreview) {
			return { previewTab: tab, preview: true, previewParams: null };
		}
		const strategyOptions = { tab };
		return await executor.step(lrClipboardAny, capture, strategyOptions /*, executor */);
	}

	async function lrLaunchOrgProtocolHandler(capture, options = {}, executor) {
		let { tab, usePreview, error, ...formatterOptions } = options || {};
		if (tab == null) {
			throw new Error('"tab" option object is required for org-protocol export');
		}

		const note = executor.step(
			function formatForOrgProtocol(capture, options, executor) {
				return lr_export.format(capture, options, executor);
			},
			capture,
			{
				format: "org-protocol",
				version: lr_export.ORG_PROTOCOL_VERION,
				options: formatterOptions,
				recursionLimit: 4,
			},
			/* executor implicit argument */);
		if (!note) {
			throw new Error(`Formatter ${format}-${version} returned empty result`);
		}
		if (usePreview == null) {
			usePreview = lr_settings.getOption("export.methods.orgProtocol.usePreview");
		}
		capture.transport.method = "org-protocol";
		if (usePreview || error) {
			return { previewTab: tab, preview: true, previewParams: null };
		}
		const strategyOptions = { tab, skipBackground: true };
		return await executor.step(lrClipboardAny, capture, strategyOptions /*, executor */);
	}

	/* Does not work for privileged content.
	 * However usually allows to avoid flashing new tab.
	 * Skip if clipboard API is disabled.
	 */
	async function _lrClipboardContentScript(capture, options) {
		const { usePreview, tab } = options || {}
		if (usePreview || !navigator.clipboard || !navigator.clipboard.writeText) {
			return;
		}
		const tabId = tab != null ? tab.id : null;
		if (!(tabId >= 0)) {
			throw new Error("_lrClipboardContentScript: invalid tabId");
		}
		// TODO handle warnings in return value
		return { preview: !await gLrAsyncScript.exec(tabId, 0, { file: "/content_scripts/lrc_clipboard.js" }) };
	}

	/* Does not work in chromium-87, "write-clipboard" or "writeClipboard" permissions
	 * does not help.
	 *     navigator.permissions.query({ name: 'clipboard-write' })
	 * reports "granted".
	 * chromium-browser: DOMException: Document is not focused.
	 *
	 * For Firefox it looks like the best method if clipboard permission
	 * is requested. At least unless it is disabled through about:config.
	 */
	async function _lrClipboardWriteBackground(capture, options) {
		const { skipBackground } = options || {}
		if (skipBackground || !navigator.clipboard || !navigator.clipboard.writeText) {
			return;
		}
		const { captureId, method } = capture && capture.transport;
		let content = captureId && capture.formats && capture.formats[captureId];
		content = method === "org-protocol" || content.format !== "org-protocol" ?
			content.body : content.url;
		if (content == null) {
			console.warn("_lrClipboardWriteBackground: unsupported capture: %o", capture);
			throw new Error("Internal error: no capture content");
		}
		const text = typeof content === "string" ? content : JSON.stringify(content, null, "  ");
		// It seems that result value is unspecified.
		// On failure the promise is rejected.
		await navigator.clipboard.writeText(text);
		return { preview: false };
	}

	async function _lrClipboardUsePreview(capture, options) {
		return { previewParams: { action: "launch" } };
	}

	async function lrClipboardAny(capture, options, executor) {
		const retvalDefault = { preview: true, previewParams: null, previewTab: options.tab };
		for (let method of [
			_lrClipboardWriteBackground, _lrClipboardContentScript, _lrClipboardUsePreview
		]) {
			try {
				const result = await executor.step(
					{ timeout: lr_tabframe.scriptTimeout },
					method, capture, options
				);
				if (result) {
					return { ...retvalDefault, ...result };
				} else {
					console.error(`lr_clipboard: ${method.name} has not succeeded`);
				}
			} catch (ex) {
				console.error(method && method.name, ex);
			}
		}
		return retvalDefault;
	}

	function initSync() {
		lr_export.registerMethod({
			method: "clipboard",
			handler: lrCopyToClipboard,
			permissions: function lrClipboardPermissions() {
				const optional = bapi.runtime.getManifest().optional_permissions;
				const hasOptional = optional && optional.indexOf("clipboardWrite") >= 0;
				const usePreview = lr_settings.getOption("export.methods.clipboard.usePreview");
				return !usePreview && hasOptional ? [ "clipboardWrite" ] : null;
			},
		});
		lr_export.registerMethod({
			method: "org-protocol",
			handler: lrLaunchOrgProtocolHandler,
			permissions: function lrOrgProtocolPermissions() {
				const optional = bapi.runtime.getManifest().optional_permissions;
				const hasOptional = optional && optional.indexOf("clipboardWrite") >= 0;
				const usePreview = lr_settings.getOption("export.methods.orgProtocol.usePreview");
				const clipboardForBody = lr_settings.getOption("export.methods.orgProtocol.clipboardForBody");
				return !usePreview && clipboardForBody && hasOptional ? [ "clipboardWrite" ] : null;
			},
		});

		lr_settings.registerGroup({
			name: "export.methods.clipboard",
			title: "Clipboard Settings",
			priority: 30,
		});
		lr_settings.registerOption({
			name: "export.methods.clipboard.usePreview",
			defaultValue: true,
			version: "0.1",
			title: "Open preview tab with capture result for clipboard",
			description: [
				"Uncheck to copy without extra action on the preview page",
				"(in Firefox it requires clipboard permission).",
				"If some problem with capture is detected, preview tab is still shown.",
				"In Chrome preview tab is required to capture privileged pages,",
				"but it may be promptly closed.",
			],
			parent: "export.methods.clipboard",
		});
		lr_settings.registerOption({
			name: "permissions.clipboardWrite",
			type: "permission",
			version: "0.2",
			title: 'Permission: Input data to the clipboard ("clipboardWrite")',
			description: [
				"In Firefox clipboard permission is required to copy capture result",
				"bypassing preview page.",
				"You can use native-messaging or org-protocol method",
				"if you are afraid",
				"that add-on can silently overwrite data in clipboard.",
			],
			parent: "export.methods.clipboard",
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
			parent: "export.methods.clipboard",
		});
		lr_settings.registerOption({
			name: "export.methods.clipboard.formatterVersion",
			defaultValue: "0.2",
			version: "0.1",
			title: "Version of formatter for clipboard",
			description: [
				"Formatters will likely be modified, and this option",
				"is intended to fix appearance of captured notes.",
				"At the current development stage it is strongly recommended",
				"to use default value.",
			],
			parent: "export.methods.clipboard",
		});
		lr_settings.registerGroup({
			name: "export.methods.orgProtocol",
			title: "Configuration of Org Protocol",
			description: [
				"For convenience you coud configure capture templates in Emacs.",
				"Most options in this group are applied to both \"native-messaging\"",
				"and \"org-protocol\" export methods.",
				"\n",
				"Warning: when org-protocol: scheme handler is globally configured",
				"in desktop environment,",
				"web sites could trick to make you adding a note with malicious content",
				"through a specially crafted link.",
				"It could be exploited independently of this extension.",
				"\n",
				"This extension could work using browser native messaging communication",
				"that still uses Emacs org-protocol package under the hood, ",
				"but it calls emacsclient directly,",
				"so it does not require global handler for org-protocol: scheme,",
				"thus it is a bit safer.",
			],
			priority: 20,
		});
		lr_settings.registerOption({
			name: "export.methods.orgProtocol.templateType",
			defaultValue: "plain",
			version: "0.2",
			title: "Template type configured in org-capture-templates (Emacs)",
			description: [
				"Either \"plain\" or \"entry\".",
				"Set to \"plain\" if you are going to paste captures through clipboard",
				"using \"C-c C-x C-y\" (org-paste-subtree).",
				"Set to \"entry\" if you have configured org-capture templates",
				"for any variant: clipboard and M-x org-capture",
				"or org-protocol using native-messaging or org-protocol: scheme handler.",
				"It is impossible to refile entry created from \"plain\" template",
				"directly from org-capture buffer.",
				'See (info "(org) Template elements") in (info "(org) Capture") section.',
			],
			parent: "export.methods.orgProtocol",
		});
		lr_settings.registerOption({
			name: "export.methods.orgProtocol.template",
			defaultValue: "",
			version: "0.1",
			title: "Template name configured in Org mode Capture",
			description: [
				"Emacs configuration should define an item in org-capture-template list, e.g.",
				"\n",
				'("e" "LinkRemark (entry)" entry (file "capture.org") "* %:initial" :empty-lines 1)',
				"\n",
				'("p" "LinkRemark (plain)" plain (file "capture.org") "%:initial" :empty-lines 1)',
				"\n",
				"Depending on value of \"Template type…\" setting.",
				"Though description (title) and url are available,",
				"body contains already formatted subtree.",
				'See (info "(org) Capture templates") for more info.', 
			],
			parent: "export.methods.orgProtocol",
		});
		lr_settings.registerOption({
			name: "export.methods.orgProtocol.usePreview",
			defaultValue: true,
			version: "0.1",
			title: "Open preview tab with capture result for org-protocol",
			description: [
				"Uncheck to launch external protocol handler",
				"without extra action on the preview page",
				"(unless some problem is detected).",
			],
			parent: "export.methods.orgProtocol",
		});
		lr_settings.registerOption({
			name: "export.methods.orgProtocol.handlerPopupSuppressed",
			defaultValue: false,
			version: "0.1",
			title: "Browser popup for external handler suppressed",
			description: [
				"Turn this on if preview for org-protocol is disabled",
				"and browser does not show popup on every org-protocol link.",
				"\"Launch&Close\" button on the preview page will silently fail",
				"if browser requires to confirm invoking external viewer",
				"while this option is enabled.",
			],
			parent: "export.methods.orgProtocol",
		});
		lr_settings.registerOption({
			name: "export.methods.orgProtocol.clipboardForBody",
			defaultValue: false,
			version: "0.1",
			title: "Copy note text to clipboard instead of setting the \"body\" parameter",
			description: [
				"Experimental option, expected template should be something like",
				"\n",
				'("c" "LinkRemark (entry, clipboard)" entry (file "capture.org") "* %(org-get-x-clipboard \'CLIPBOARD)" :empty-lines 1)',
				"\n",
				"or \"plain\" instead of \"entry\", remember to adjust",
				"\"Template type…\" setting to the same value.",
				"Unsure if lenthy captures could really cause a trouble",
				"with external protocol handlers. Anyway using",
				"native messaging backend could be a more reliable option.",
				"Though description (title) and url parameters are available,",
				"clipboard contains already formatted subtree.",
			],
			parent: "export.methods.orgProtocol",
		});
		lr_settings.registerOption({
			name: "export.methods.orgProtocol.formatterType",
			defaultValue: "org",
			version: "0.1",
			title: "Formatter for org-protocol handler",
			description: [
				"Currently the only meaningful option is \"org\".",
				"JSON generated by \"object\" format may be used to implement",
				"custom formatter inside Emacs.",
				"I do not consider structure format as settled,",
				"so be prepared to breaking changes",
				"if you are experimenting with this option.",
				"Likely instead of changing value here,",
				"it is better to request particular format",
				"from custom native messaging app.",
			],
			parent: "export.methods.orgProtocol",
		});
		lr_settings.registerOption({
			name: "export.methods.orgProtocol.formatterVersion",
			defaultValue: "0.2",
			version: "0.1",
			title: "Version of formatter for org-protocol",
			description: [
				"Formatters will likely be modified, and this option",
				"is intended to fix appearance of captured notes.",
				"It does not work at the current development stage,",
				"so, please, keep default value active for a while.",
			],
			parent: "export.methods.orgProtocol",
		});
	};

	Object.assign(this, {
		initSync,
		_lrClipboardWriteBackground,
		_lrClipboardContentScript,
		_lrClipboardUsePreview,
		_internal: {
			lrCopyToClipboard,
			lrLaunchOrgProtocolHandler,
			lrClipboardAny,
		},
	});
	return this;
});
