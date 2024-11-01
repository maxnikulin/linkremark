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

/** Do not omit undefined values, convert them to to `null` */
function jsonStringify(obj) {
	return JSON.stringify(obj, (k, v) => v !== undefined ? v : null, "  ");
}

function lrPromiseTimeout(delay) {
	return new Promise(resolve => setTimeout(resolve, delay, delay));
}

function lrWithTimeout(timeout, func) {
	return function lrRunWithTimeout(...args) {
		return Promise.race([
			func(...args),
			new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeout)),
		]);
	};
}

async function lrCopyToClipboard(text) {
	// TODO progress notification
	let result = lr_common.copyUsingEvent(text);
	if (result) {
		return result;
	} else {
		console.warn("lrCopyUsingEvent failed");
	}
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text || "");
		return true;
	}
	throw new Error("Copy to clipboard failed");
}

async function lrCloseWindow(timeout) {
	await lrPromiseTimeout(timeout >= 0 ? timeout : 1000);
	window.close();
	await lrPromiseTimeout(25);
	throw new Error("Unable to close the window");
}

function lrRequestNativeMessagingPermission() {
	const permission = "nativeMessaging";
	const manifest = bapi.runtime.getManifest();
	const optional = manifest.optional_permissions;
	const hasOptional = optional && optional.indexOf(permission) >= 0;
	if (!hasOptional) {
		return manifest.permissions.indexOf(permission) >= 0;
	}
	return bapi.permissions.request({ permissions: [ permission ] })
		.catch(ex => { console.error("request ${permission} permission: %s", ex); throw ex; });
}

function lrAdjustTextAreaHeight(textarea) {
	const maxHeight = 50;
	const reserve = 2;
	/* Approach with `getComputedStyle` is less reliable
	 * due to `lineHeight` may be `normal` and proper factor
	 * for fontSize is rather uncertain. */
	textarea.classList.add("disableFlex");
	const lineHeightPx = textarea.clientHeight/textarea.rows;
	const windowHeight = Math.floor(0.8*window.innerHeight/lineHeightPx);
	const contentHeight = Math.ceil(textarea.scrollHeight/lineHeightPx) + reserve;
	textarea.classList.remove("disableFlex");
	textarea.rows = Math.min(maxHeight, windowHeight, contentHeight);
}

function lrCaptureForExport(state, format) {
	if (!format) {
		format = state.transport && state.transport.format;
	}
	return lrPmCaptureForExport(state.capture, format);
}

async function lrCopyAction(dispatch, getState) {
	const state = getState();
	const projection = lrPmGetCurrentProjectionFromState(state);
	const text = projection
		&& ( projection.format === "org-protocol" ? projection.url : projection.body);
	if (!text) {
		throw new Error("No text to copy");
	}
	await lrCopyToClipboard(text);
}

async function lrNativeMessagingAction(dispatch, getState) {
	const state = getState();
	const name = state.transport && state.transport["native-messaging"] && state.transport["native-messaging"].name;
	const capture = lrCaptureForExport(state);
	/*
	 * Do not do it. At least in Firefox-92 it invokes `browserAction.onClicked`
	 * listener if popup is disabled.
	 * To have a synchronous check whether a popup is set,
	 * it is necessary to implement subscription for set popup events.
	 *
	 * Can not reproduce it with Firefox-115 ESR:
	 *
	 *     Error: No popup URL is set
	 *
	 * Perhaps I was confused by capture initiated by loading of the popup page.
	 */
	/*
	try {
		bapi.browserAction.openPopup();
	} catch (error) {
		lrPreviewLogException({ dispatch, getState }, {
			message: "A problem with export lock",
			error, debugInfo,
		});
	}
	*/
	// TODO check that response to the same request received
	const response = await lr_common.sendMessage(
		"export.process", [ capture, { method: "native-messaging", backend: name } ]);
	const { error, debugInfo } = response || {};
	if (debugInfo) {
		lrDebugInfoAdd(debugInfo);
	}
	if (error) {
		throw new Error(error.message || "A problem during native app export");
	};
	return response.result;
}

async function lrLaunchOrgProtocolHandlerAction(dispatch, getState) {
	const state = getState();
	const projection = lrPmGetCurrentProjectionFromState(state);
	const { body, url, title } = projection;
	const { clipboardForBody, template, baseURL } = state.transport["org-protocol"] || {};
	const arg = { url, title, template }
	if (clipboardForBody) {
		// If there is no body than clipboard content should be cleared anyway.
		await lrCopyToClipboard(body);
	} else if (body != null && body != "") {
		arg.body = body;
	}
	const protocolURL = baseURL ? lr_org_protocol.makeUrl(arg, baseURL) : lr_org_protocol.makeUrl(arg);
	await lr_org_protocol.launchThroughIframe(protocolURL);
}

async function lrPreviewGetCapture(dispatch, getState) {
	const cached = await lr_common.sendMessage("store.getResult");

	// No try-catch is necessary here
	if (cached === "NO_CAPTURE") {
		lrPreviewMentionsOpen();
		// Original idea was to add a dedicated format tab that suggest
		// using of this page as a playground with no guide for debug.
		// In the case of severe error it may be confusing however.
		dispatch(gLrPreviewLog.finished({
			id: lr_common.getId(),
			message: "Nothing has been captured yet",
			name: "Warning",
		}));
		return;
	}
	const { debugInfo, error, result } = cached || {};
	const { capture, mentions } = result || {};

	try {
		if (debugInfo) {
			if (error || !capture) {
				lrDebugInfoExpand();
			}
			lrDebugInfoAdd(debugInfo);
		}
	} catch (ex) {
		lrPreviewLogException({ dispatch, getState }, { message: "Failed to set debug info", error: ex });
	}

	// Keep this after `lrDebugInfoExpand`.
	if (!cached) {
		throw new Error("Internal error: unable to get capture result");
	}

	const method = capture && capture.transport && capture.transport.method;

	try {
		if (capture != null) {
			dispatch(gLrPreviewActions.captureResult(capture));
			const state = getState();
			const current = state && state.capture && state.capture.current;
			let format;
			const formatVariants = ["org", "object"];
			const projectionId = capture && capture.transport && capture.transport.captureId;
			const projection = projectionId == null ? null : state && state.capture &&
				state.capture.formats && state.capture.formats[projectionId];
			if (projection && projection.format) {
				if (method !== "clipboard" && projection.format === "org-protocol") {
					// It is rather confusing when for org-protocol export method
					// org-protocol format is selected. Lauch leads another pass
					// of wrapping org-protocol URI and broken captures in Emacs.
					const src = state.capture.formats[projection.src];
					if (src && src.format) {
						formatVariants.unshift(src.format);
					}
				} else {
					formatVariants.unshift(projection.format);
				}
			}
			for (const f of formatVariants) {
				if (current && current[f]) {
					format = f;
					break;
				}
			}
			if (format) {
				dispatch(gLrPreviewActions.exportFormatSelected(format));
			}
		} else {
			dispatch(gLrPreviewLog.finished({
				id: lr_common.getId(),
				message: "No capture result received",
				name: "Error",
			}));
		}
	} catch (ex) {
		lrPreviewLogException({ dispatch, getState }, { message: "Failed to set capture", error: ex });
	}

	try {
		// Show check URL form if nothing has been captured yet (see above)
		// or if result of check does not clearly show that no mentions found
		// (unsupported feature or no URLs found). Suppress the form
		// if error happened before capture is at least partially generated.
		if (
			mentions != null ?
				!lrMentionsIsSilent(mentions.mentions) :
				(capture != null || debugInfo == null)
		) {
			lrPreviewMentionsOpen();
		}
		if (mentions) {
			dispatch(gLrMentionsActions.mentionsResult(mentions));
		}
	} catch (ex) {
		lrPreviewLogException({ dispatch, getState }, { message: "Failed to set known URLs", error: ex });
	}

	try {
		if (method) {
			/* TODO At least privileged tab or frame warning should not cause
			 * fallback to another export method. Maybe only export error
			 * should prevent switch to configured export method. */
			if (true /* mentions || method != "native-messaging" */) {
				dispatch(gLrPreviewActions.exportMethodSelected(method));
			}
			dispatch(gLrPreviewActions.focusTransportMethod(method));
		}
	} catch (ex) {
		lrPreviewLogException({ dispatch, getState }, { message: "Failed to set export method", error: ex });
	}

	let launchResult = false;
	const params = new URLSearchParams(window.location.search);
	const action = params.get("action");
	// No point for try-catch for last action since error will be reported by the caller.
	if (error) {
		lrPreviewLogException({ dispatch, getState }, { message: "A problem with capture", error });
		await lr_common.sendMessage("store.putPreviewError", lr_common.errorToObject(
			new LrWarning("User action required due to error or warning")));
		await lrPromiseTimeout(1000);
	} else if (method) {
		if (action === "launch") {
			const state = getState();
			const protocolSettings = state && state.transport && state.transport['org-protocol'];
			const handlerPopupSuppressed = method !== "org-protocol" || (
				protocolSettings && protocolSettings.handlerPopupSuppressed);
			launchResult = await dispatch(lrMakeTransportAction({
				close: handlerPopupSuppressed,
				method: method,
				launch: true,
			}));
		}
	}
	// Reload to get all export errors
	if (!launchResult && action === "launch") {
		params.delete("action");
		window.location.search = params.toString();
	}
}

function lrMakeTransportAction({ method, close, launch }) {
	/* `launch` argument is necessary because exception is not propagated
	 * to the caller to avoid double error reporting. */
	const actions = {
		"clipboard": lrCopyAction,
		"org-protocol": lrLaunchOrgProtocolHandlerAction,
		"native-messaging": lrNativeMessagingAction,
	};
	const handler = actions[method];
	return async function lrTransportAction(dispatch, getState) {
		const id = lr_common.getId();
		let delayTime = Date.now() + 1000;
		try {
			if (!handler) {
				throw new Error("Unknown method");
			}
			dispatch(gLrPreviewLog.started({
				id, message: `Exporting using ${method}...` }));
			await handler(dispatch, getState);
			if (launch) {
				await lr_common.sendMessage("store.putPreviewError", false);
			}
			dispatch(gLrPreviewLog.finished({
				id, message: `Exported using ${method}` }));
			if (close) {
				await lrCloseWindow(Math.min(0, delayTime - Date.now()));
			}
			return true;
		} catch (ex) {
			console.error("lrTransportAction: %o", ex);
			dispatch(gLrPreviewLog.finished({
				id, message: `Export failed: ${method}: ${String(ex?.message ?? ex ?? "Unknown error")}`,
				name: "Error",
			}));
			if (launch) {
				await lr_common.sendMessage(
					"store.putPreviewError",
					lr_common.errorToObject(ex || new Error("Unknown error")));
				try {
					const tab = await chrome.tabs.getCurrent();
					await chrome.tabs.update(tab.id, { active: true });
				} catch (ex) {
					Promise.reject(ex);
				}
				// Delay before reload
				await lrPromiseTimeout(delayTime - Date.now());
			}
		}
		return false;
	}
}

function lrMakeUpdateProjectionAction(format) {
	return async function lrUpdateProjectionAction(dispatch, getState) {
		dispatch({ type: "transport/formatSelected", data: format });
		try {
			function debug(fmt, ...args) {
				if (false) {
					console.debug("lrUpdateProjectionAction(%s): " + fmt, format, ...args);
				}
			}
			const state = getState();
			const currentProjection = lrPmGetCurrentProjectionFromState(state, { format, nothrow: true });
			if (currentProjection && currentProjection.modified != null) {
				if (
					!lrPmProjectionsEqual(
						currentProjection, state.capture.formats[currentProjection.modified], false)
				) {
					debug("modified");
					return;
				}
				debug("options modified");
			}

			const capture = lrPmCaptureForExport(state.capture, format);
			if (capture == null) {
				if (format === "org-protocol") {
					debug("org-protocol options");
					const availableFormats = await lr_common.sendMessage("export.availableFormats");
					const { options } = availableFormats.find(f => f.format === "org-protocol");
					return dispatch(gLrPreviewActions.captureFormat(lrPmDefaultProjection(format, options)));
				} else {
					debug("no source");
				}
				return;
			}
			const transportId = capture.transport && capture.transport.captureId;
			if (currentProjection && transportId === currentProjection.id) {
				debug("up to date");
				return;
			}
			debug("updating");
			const options = currentProjection && currentProjection.options &&
				JSON.parse(currentProjection.options);
			const { result: newCapture, error, debugInfo } =
				await lr_common.sendMessage(
					"export.format",
					[ capture, { format, version: LR_PM_DEFAULT_FORMAT_VERSIONS[format], options } ]
				) || {};
			if (error) {
				lrPreviewLogException(
					{ dispatch, getState }, {
						message: `A problem during formatting to ${format}`,
						error, debugInfo
					});
			} else if (debugInfo) {
				lrDebugInfoAdd(debugInfo);
			}
			return dispatch(gLrPreviewActions.captureResult(newCapture));
		} catch (ex) {
			console.error("lrUpdateProjectionAction: %o", ex);
			// TODO report progress
			dispatch(gLrPreviewLog.finished({
				id: lr_common.getId(),
				message: `Formatting to ${format} failed: ${ex}`,
				name: "Error",
			}));
		}
	};
}

// Debug info is intentionally managed outside of state store with hope of higher reliability.

function lrDebugInfoExpand() {
	try {
		const details = byId("debugInfo").parentNode;
		details.setAttribute("open", true);
	} catch (ex) {
		console.error("lrDebugInfoExpand: internal error: %o", ex);
	}
}

function lrDebugInfoAdd(entry) {
	try {
		const header = byId("debugInfo");
		const next = header.nextElementSibling;
		entry = entry || "Missed error info";
		if (entry.stack) {
			entry = lr_common.errorToObject(entry);
		}
		const text = typeof entry === "string" ? entry : jsonStringify(entry);
		const fragment = new DocumentFragment();
		fragment.append(
			E('div', { className: "limitedWidth" }, new Date().toLocaleString()),
			E('pre', null, text),
		);
		header.parentNode.insertBefore(fragment, next);
	} catch (ex) {
		console.error("lrDebugInfoAdd: internal error: %o", ex);
	}
}

class LrTitle {
	constructor(props) {
		this.pageTitle = byId("pageTitle");
		this.updateProps(props);
	}
	updateProps(props) {
		// capture, title, error, state
		this.props = props;
		props = props || {};
		let header;
		const titleValue = props.title || props.error;
		let title = titleValue != null ? String(titleValue) : "Sandbox & Debug Info";
		let shortStatus = "";
		let headerStatus = "";
		if (props.state === "warning" ) {
			shortStatus = "W";
			headerStatus = "Warning";
		} else if (props.state === "error") {
			shortStatus = "E";
			headerStatus = "Error";
		} else if (props.state === "success") {
			shortStatus = "v";
		} else if (props.state === "wait") {
			shortStatus = "…";
		} else if (props.capture) {
			headerStatus = "Capture Preview";
		}

		if (shortStatus) {
			shortStatus = `[${shortStatus}]`;
		}
		if (headerStatus) {
			headerStatus = " " + headerStatus;
		}
		document.title = `LR${shortStatus}: ${title}`;
		this.pageTitle.textContent = `LinkRemark${headerStatus}: ${title}`;
	}
}

class LrTabSwitcher {
	constructor(props) {
		this.props = props;
		this._buttons = {};
		const elements = [ E('div', null, props.label && (props.label + " ")) ];
		for (const tab of props.tabs) {
			const button = E('input', { type: "radio", name: props.name, value: tab.key });
			elements.push(E('label', null, button, ' ' + tab.label));
			this._buttons[tab.key] = button;
			if (tab.onchange) {
				button.addEventListener("change", tab.onchange, false);
			}
		}
		this.dom = E('div', { className: "limitedWidth" },
			E('form', { className: "flexLineContainer" }, ...elements));
		this._onChange = this._doOnChange.bind(this);
		this.dom.addEventListener("change", this._onChange, false);
	}
	updateProps(props) {
		this.props = props;
		if (!this.props || !this._buttons) {
			return;
		}
		const active = this.props.active;
		if (this.props.ignore && this.props.ignore.indexOf(active) >= 0) {
			return;
		}
		const button = this._buttons[active];
		if (!button) {
			console.error("LrTabSwitcher: %o: unknown key: %o", this.props.name, active)
		} else {
			button.checked = true;
		}
	}

	_doOnChange(e) {
		const target = e.target;
		const checked = target.checked;
		target.checked = !target.checked;
		if (checked && this.props.onselect) {
			this.props.onselect(target.value);
		}
	}
}

class LrTabGroup {
	constructor(props) {
		this.dom = E('div', /*{ className: 'limitedWidth' }, E('div',*/ { className: 'tabContainer' },
			...props.tabs.map(t => t.dom)); //);
		if (props.limitedWidth) {
			this.dom.classList.add("limitedWidth");
		}
		this.updateProps(props);
	}
	updateProps(props) {
		this.props = props;
		const visibleName = this.props && this.props.active;
		let visibleTab = null;
		for (const t of this.props.tabs) {
			if (t.name !== visibleName) {
				if (visibleTab) {
					t.dom.classList.add("hideRight");
					t.dom.classList.remove("hideLeft");
				} else {
					t.dom.classList.add("hideLeft");
					t.dom.classList.remove("hideRight");
				}
			} else {
				visibleTab = t.dom;
					t.dom.classList.remove("hideLeft");
					t.dom.classList.remove("hideRight");
			}
		}
		if (!visibleTab && this.props) {
			console.error("LrTabGroup: unknown tab: %o", visibleName);
		}
	}
}

class LrPreviewLog {
	constructor(props) {
		this.dom = E('ul', { className: 'limitedWidth log' });
		this.updateProps(props);
	}
	updateProps(props) {
		this.props = props;
		const items = this.props && this.props.items;
		if (!items) {
			return;
		}
		const { childNodes } = this.dom;
		const existingMap = new Map();
		for (const e of this.dom.childNodes) {
			existingMap.set(e.dataset.lrId, e);
		}
		const updatedMap = new Map(items.map(n => [ n.id, n ]));

		function cls(entry) {
			if (entry.name) {
				return lr_common.isWarning(entry) ? "warning" : "error"; // FIXME
			}
			return 'time' in entry ? 'success' : '';
		}
		function msg(entry) {
			return entry.message;
		}
		function create(entry) {
			const li =  E('li', { className: cls(entry) }, msg(entry));
			li.dataset.lrId = entry.id;
			return li;
		}

		for (const [key, value] of existingMap) {
			const updated = updatedMap.get(key);
			if (!updated) {
				value.remove();
			} else {
				value.classList = cls(updated);
				value.innerText = msg(updated);
			}
		}
		let iProps = 0;
		for (let iDom = 0; iDom < childNodes.length; ++iDom) {
			for ( ; iProps < items.length; ++iProps) {
				if (childNodes[iDom].dataset.lrId === items[iProps].id) {
					++iProps;
					break;
				}
				const e = existingMap.get(items[iProps].id);
				if (e) {
					this.dom.insertBefore(e, childNodes[iDom]);
				} else {
					this.dom.insertBefore(create(items[iProps]), childNodes[iDom]);
				}
			}
		}
		for ( ; iProps < items.length; ++iProps) {
			this.dom.insertBefore(create(items[iProps]), null);
		}
	}
}

class LrNativeMessagingMissedPermissionTab {
	constructor() {
		const button = E('button', null, "Request Permission");
		button.addEventListener("click", lrRequestNativeMessagingPermission, false);
		this.dom = E('div', { className: "limitedWidth" },
			E('p', null, "Please, grant permission to communicate with native applications."),
			button);
	}
}

class LrMethodTabBase {
	constructor(props, { execName, execCloseName }) {
		const { method }  = props;
		this.state = {};
		this.execClose = E('button', null, execCloseName || "Execute and Close");
		this.exec = E('button', null, execName || "Execute");
		const execListener = ev => {
			ev.preventDefault();
			if (this.props && this.props.exec) {
				const options = { method };
				if (ev.target === this.execClose) {
					options.close = true;
				}
				this.props.exec(options);
			} else {
				console.error(`LrMethodTabBase(${method}): props.exec not set`);
			}
		};
		this.exec.addEventListener('click', execListener, false);
		this.execClose.addEventListener('click', execListener, false);
		this.dom = E('form', { className: "limitedWidth" },
			E('div', null, this.execClose, this.exec));
		this.dom.addEventListener("change",
			ev => {
				const value = ev.target.type === "checkbox" ? ev.target.checked : ev.target.value;
				this.props.onchange({ method, name: ev.target.name, value });
			},
			false);
	}
	updateProps(props) {
		if (props) {
			const { focus } = props;
			if (focus != null && !(this.state.focus >= focus)) {
				this.state.focus = focus;
				if (this.execClose.disabled) {
					this.exec.focus();
				} else {
					this.execClose.focus();
				}
			}
		}
		this.props = props;
	}
}

class LrNativeMessagingTab extends LrMethodTabBase {
	constructor(props) {
		super(props, { execName: "Execute", execCloseName: "Execute & Close" });
		this.name = E('input', { className: 'long', name: 'name' });
		this.appInfo = E('div', { className: "flexGrow" });
		const fragment = new DocumentFragment();
		fragment.append(
			E('label', { className: 'flexLineContainer' },
				E('div', { className: 'flexFixed fixed' }, 'App Name'),
				this.name,
			),
			this.appInfo,
		);
		this.dom.append(fragment);
		this.updateProps(props);
	}
	updateProps(props) {
		if (props) {
			const name = props.name;
			if (name && this.name.value !== name) {
				this.name.value = name;
			}
		}
		super.updateProps(props);
	}
}

class LrClipboardTab extends LrMethodTabBase {
	constructor(props) {
		super(props, { execName: "Copy", execCloseName: "Copy & Close" })
		this.updateProps(props);
	}
}

class LrOrgProtocolTab extends LrMethodTabBase {
	constructor(props) {
		super(props, { execName: "Launch", execCloseName: "Launch & Close" });
		this.template = E('input', { name: "template", size: 3, className: "flexFixed" });
		this.baseURL = E('input', { name: "baseURL", className: "flexFixed" });
		this.clipboardForBody = E('input', { type: "checkbox", name: "clipboardForBody" });
		this.handlerPopupSuppressed = E('input', { type: "checkbox", name: "handlerPopupSuppressed" });
		const fragment = new DocumentFragment();
		fragment.append(
			E('div', { className: "flexLineContainer" },
				E('label', null,
					"Key (name of template) ",
					this.template,
				),
				E('label', null,
					"baseURL ",
					this.baseURL,
				),
			),
			E('div', { className: "flexLineContainer" },
				E('label', null, this.clipboardForBody, " copy body to clipboard"),
				E('label', null, this.handlerPopupSuppressed, " allow to close the window"),
			),
		);
		this.dom.append(fragment);
		this.updateProps(props);
	}
	updateProps(props) {
		if (props) {
			const allowClose = "handlerPopupSuppressed" in props && props.handlerPopupSuppressed;
			this.execClose.disabled = !allowClose;
			this.dom.elements.template.value = props.template || "";
			this.dom.elements.baseURL.value = props.baseURL || "";
			this.dom.elements.handlerPopupSuppressed.checked = allowClose;
			this.dom.elements.clipboardForBody.checked = props.clipboardForBody;
		}
		super.updateProps(props)
	}
}

function lrMethodTabMapDispatchToProps(dispatch) {
	return {
		onchange: data => dispatch(gLrPreviewActions.transportChange(data)),
		exec: parameters => dispatch(lrMakeTransportAction(parameters)),
	};
}

function LrMethodTabElement({store, method, Factory}) {
	this.name = method;
	const methodTab = new (store.connect(
		function lrMethodTabMapStateToProps(state) {
			return state.transport && state.transport[method];
		},
		lrMethodTabMapDispatchToProps,
	)(Factory))({ method });
	this.dom = methodTab.dom;
}

class LrNoCaptureTab {
	constructor() {
		this.dom = byId("missedResult").content.children[0].cloneNode(true);
	}
}

class LrFormatTab {
	constructor(props) {
		this.state = {};
		const children = [];
		children.push(E('div', { className: "scroll flexGrow" }, E('textarea', {
			name: "body",
			className: "limitedWidth",
			rows: 5,
			cols: 132,
		})));
		const urlLabelText = "Url";
		if (props && props.longUrl) {
			children.push(
				E('label', { className: "limitedWidth" }, urlLabelText),
				E('div', { className: "scroll flexGrow" }, E('textarea', {
					name: "url",
					className: "limitedWidth",
					rows: 3,
					cols: 132,
				})),
			);
		} else {
			children.push(E('label', { className: "flexTabLine limitedWidth" },
				E('div', { className: "flexFixed fixed" }, "Url"), " ",
				E('input', { className: "long", name: "url" }),
			));
		}
		children.push(E('label', { className: "flexTabLine limitedWidth" },
			E('div', { className: "flexFixed fixed" }, "Title"), " ",
			E('input', { className: "long", name: "title" }),
		));
		if (props && props.useOptions) {
			children.push(E('div', { className: "scroll" }, E('textarea', {
				name: "options",
				className: "limitedWidth",
				rows: 5,
				cols: 132,
			})));
		}
		this.reset = E('button', null, "Reset");
		this.reset.addEventListener("click", ev => {
			ev.preventDefault();
			const action = this.props && this.props.onreset;
			if (action) {
				action();
			} else {
				console.error("LrFormatTab: props.reset not set");
			}
		}, false);
		children.push(E('div', { className: "limitedWidth" }, this.reset));
		this.dom = E('form', { className: "tabPane" }, ...children);
		this.dom.addEventListener("change", ev => {
			const onchange = this.props && this.props.onchange;
			if (onchange) {
				this.props.onchange({ field: ev.target.name, value: ev.target.value });
			} else {
				console.error("LrTabFormat: onchange is not provided");
			}
		}, false);
		this.updateProps(props);
	}
	updateProps(props) {
		if (!props) {
			return;
		}
		this.props = props;
		const { elements } = this.dom;
		for (const name of ["body", "title", "url", "options" ]) {
			const e = elements[name];
			if (!e) {
				continue; // options are optional
			}
			e.value = props[name] || "";
		}
		if (props.modified != null) {
			this.reset.classList.remove("invisible");
		} else {
			this.reset.classList.add("invisible");
		}
		if (this.props.adjust != null && !(this.state.adjust >= this.props.adjust)) {
			lrAdjustTextAreaHeight(this.dom.elements[this.props.longUrl ? "url" : "body"]);
			this.state.adjust = this.props.adjust;
		}
	}
}

LrFormatTab.stateToProps = function(format) {
	return function lrFormatTabStateToProps(state) {
		return lrPmGetCurrentProjectionFromState(state, { format, nothrow: true });
	};
};

LrFormatTab.dispatchToProps = function(format) {
	return function lrFormatTabDispatchToProps(dispatch) {
		return {
			onchange: data => dispatch(gLrPreviewActions.captureChanged({ ...data, format })),
			onreset: () => dispatch(gLrPreviewActions.captureReset(format)),
		};
	};
};

LrFormatTab.tab = function(format, store, ...args) {
	return {
		name: format,
		dom: (new (store.connect(
			LrFormatTab.stateToProps(format),
			LrFormatTab.dispatchToProps(format),
		)(LrFormatTab)) (...args)).dom,
	};
};

function lrExportReducer(state = {}, { type, data }) {
	switch (type) {
		case "transport/methodSelected":
			return { ...state, method: data };
			break;
		case "transport/formatSelected":
			return { ...state, format: data };
			break;
		case "transport/settings": {
			const mapping = [
				[ "export.methods.nativeMessaging.backend", "native-messaging", "name"],
				[ "export.methods.orgProtocol.template", "org-protocol", "template" ],
				[ "export.methods.orgProtocol.handlerPopupSuppressed", "org-protocol", "handlerPopupSuppressed" ],
				[ "export.methods.orgProtocol.clipboardForBody", "org-protocol", "clipboardForBody" ],
				[ "export.methods.orgProtocol.captureBaseURL", "org-protocol", "baseURL" ],
			];
			for (const [option, method, parameter] of mapping) {
				const value = data[option];
				if (
					value == null || value === "" ||
					(state[method] && state[method][parameter] === value)
				) {
					continue;
				}
				const replace = { ...(state[method] || {}) };
				replace[parameter] = value;
				state = { ...state, [method]: replace };
			}
			break;
		}
		case "transport/change": {
			const { method, name, value, source } = data;
			const methodSettings = state[method] || {};
			const currentSource = methodSettings.source;
			if (
				methodSettings[name] === value
				|| source === "user" || !currentSource || (currentSource === "settings" && source === "capture")
			) {
				state = { ...state, [method]: { ...methodSettings, [name]: value, source } };
			}
			break;
		}
		default:
			console.error("lrExportReducer: unknown action: %o %o", type, data);
			lrPreviewLogException(null, {
				message: "Internal error",
				error: new Error(`Unsupported action "${type}"`)
			});
	}
	return state;
}

function lrCaptureReducer(state, action) {
	return lrPmCaptureGc(lrCaptureReducerDirty(state, action));
}

function lrCaptureReducerDirty(state = { formats: {}, current: {} }, { type, data }) {
	switch (type) {
		case "capture/changed":
			return lrPmUpdateProjection(state, data);
			break;
		case "capture/reset": {
			const format = data;
			const projection = state.formats[state.current[format]];
			if (projection == null || projection.modified == null) {
				console.error("lrCaptureReducer: %s: not modified: %o", type, projection);
				return state;
			}
			const current = { ...state.current, [format]: projection.modified };
			return { ...state, current, };
		}
		case "capture/result":
			return lrPmCaptureUpdate(state, data);
		case "capture/format": {
			const capture = {
				...state,
				formats: { ...state.formats },
				current: { ...state.current },
			};
			capture.formats[data.id] = lrPmProjectionCaptureToState(data);
			capture.current[data.format] = data.id;
			return capture;
		}
		default:
			console.error("lrCaptureReducer: unknown action: %o %o", type, data);
			lrPreviewLogException(null, {
				message: "Internal error",
				error: new Error(`Unsupported action "${type}"`),
			});
	}
	return state;
}

const gLrPreviewActions = {
	exportMethodSelected: function(method) {
		return { type: "transport/methodSelected", data: method };
	},
	exportFormatSelected: lrMakeUpdateProjectionAction,
	settings: function(settings) {
		return { type: "transport/settings", data: settings };
	},
	captureResult: function(capture) {
		return { type: "capture/result", data: capture };
	},
	captureChanged: function(diff) {
		return { type: "capture/changed", data: diff };
	},
	captureReset: function(format) {
		return { type: "capture/reset", data: format };
	},
	captureFormat: function(projection) {
		return { type: "capture/format", data: projection };
	},
	transportChange: function(nameValue) {
		return { type: "transport/change", data: { source: "user", ...nameValue } } ;
	},
	focusTransportMethod: function(method) {
		return { type: "transport/change", data: { name: "focus", value: lr_common.getId(), method } };
	},
};

function lrPreviewLogReducer(state = [], { type, data }) {
	const maxNumber = 5;
	const delay = 10000;
	if (!data || data.id == null) {
		lrPreviewLogException(null, {
			message: "Internal error",
			error: new Error(`No data for "${type}" action`),
		});
		return state;
	}

	// id will be used as dom node attribute
	const dataFixed = { ...data, id: String(data.id) };

	function limit(elements) {
		if (elements.length <= maxNumber) {
			return elements;
		}
		const threshold = Date.now() - delay;
		const candidates = elements.map((e, i) => e.time < threshold && { i, time: e.time })
			.filter(e => !!e);
		candidates.sort((a, b) => a.time < b.time);
		const toRemove = new Set(candidates.splice(0, elements.length - maxNumber).map(e => e.i));
		return elements.filter((_, i) => !toRemove.has(i));
	}

	function replace(elements, result) {
		result.time = Date.now();
		let found = false;
		const retval = result.id != null
			? elements.map(e => e.id === result.id ? (found = result) : e)
			: [ ...elements, result ];
		if (!found) {
			retval.push(result);
		}
		return limit(retval);
	}

	switch (type) {
		case "log/started":
			return limit([ ...state, dataFixed ]);
		case "log/finished":
			return replace(state, dataFixed);
		default:
			console.error("lrPreviewLogReducer: unknown action: %o %o", type, data);
			lrPreviewLogException(null, {
				message: "Internal error",
				error: new Error(`Unsupported action "${type}"`),
			});
	}
	return state;
}

const gLrPreviewLog = {
	started(messageAndId) { return { type: "log/started", data: messageAndId } },
	finished(messageAndId) { return { type: "log/finished", data: messageAndId } },
}

function lrPreviewLogException(store, data) {
	// `console.error` adds a rather useless message
	//     lrPreviewLogException: %o [object Object]
	//  to collected errors in extension properties
	//  e.g. in the case of inaccessible frame.
	if (data?.error instanceof Error) {
		Promise.reject(data.error);
	} else {
		console.log("lrPreviewLogException: %o", data);
	}
	try {
		const { message, error, id, debugInfo } = data || {
			message: "Internal error",
			error: new Error("Attempt to log nothing"),
		};

		try {
			lrDebugInfoAdd(debugInfo || error);
			lrDebugInfoExpand();
		} catch (ex) {
			console.error("lrPreviewLogException: internal error: debug info: %o", ex);
		}

		try {
			if (store) {
				function errorText(error) {
					return error.message ||
						(error.cause && (error.cause.message || error.cause.name));
				}

				try {
					if (error.errors && error.errors.length > 0) {
						for (const subError of error.errors) {
							if (!subError) {
								continue;
							}
							const message = errorText(subError);
							const name = String(subError.name || "OtherError");
							store.dispatch(gLrPreviewLog.finished({
								id: lr_common.getId(),
								message: String(message || subError.name || subError),
								name,
							}));
						}
					}
				} catch (ex) {
					console.error(
						"LR: internal error during reporting of an aggregate error: %o %o",
						error, error.errors);
				}
				let errorMessage = errorText(error);
				if (message) {
					errorMessage = errorMessage ? message + ": " + String(errorMessage) : String(message);
				} else {
					errorMessage = String(errorMessage || error.name || error);
				}
				const name = (error && error.name) || "OtherError";
				store.dispatch(gLrPreviewLog.finished({
					id: id != null ? id : lr_common.getId(),
					message: errorMessage,
					name: String(name),
				}));
			}
		} catch (ex) {
			console.error("lrPreviewLogException: internal error: dispatch to store: %o", ex);
		}
	} catch (ex) {
		console.error("lrPreviewLogException: internal error: %o", ex);
	}
}

function lrCreateCaptureView(store) {
	const fragment = new DocumentFragment();
	const methodSwitcher = new (
		store.connect(
			function lrMethodSwitcherStateToProps(state) {
				return { active: state && state.transport && state.transport.method };
			},
			function lrMethodSwitcherDispatchToProps(dispatch) {
				return {
					onselect: (method) => dispatch(gLrPreviewActions.exportMethodSelected(method)),
				};
			},
		)(LrTabSwitcher)
	)({
		name: "export.method",
		label: "Export:",
		tabs: [ {
			key: "clipboard", label: "Clipboard",
		}, {
			key: "native-messaging", label: "Native app",
			onchange: e => {
				if (e.target.checked) {
					return lrRequestNativeMessagingPermission();
				}
			},
		}, {
			key: "org-protocol", label: "org-protocol",
		} ],
	});
	fragment.append(methodSwitcher.dom);

	const methodTabs = new (
		store.connect(function lrMethodTabsStateToProps(state) {
			const transport = state && state.transport && state.transport.method;
			if (transport !== "native-messaging") {
				return { active: transport };
			}
			const hasNativeMessagingPermission = state && state.permissions
				&& state.permissions.nativeMessaging && state.permissions.nativeMessaging.state;
			return {
				active: hasNativeMessagingPermission ? transport : "native-messaging-permissions"
			};
		})(LrTabGroup)
	)({ limitedWidth: true,
		tabs: [
			new LrMethodTabElement({ method: "clipboard", store, Factory: LrClipboardTab }),
			{
				name: "native-messaging-permissions",
				dom: new LrNativeMessagingMissedPermissionTab().dom,
			},
			new LrMethodTabElement({ method: "native-messaging", store, Factory: LrNativeMessagingTab }),
			new LrMethodTabElement({ method: "org-protocol", store, Factory: LrOrgProtocolTab }),
		],
	});
	fragment.append(methodTabs.dom);

	const formatSwitcher = new (
		store.connect(
			function lrFormatSwitcherStateToProps(state) {
				return { active: state && state.transport && state.transport.format };
			},
			function lrFormatSwitcherDispatchToProps(dispatch) {
				return {
					onselect: format => dispatch(gLrPreviewActions.exportFormatSelected(format)),
				};
			},
		)(LrTabSwitcher)
	)({
		name: "export.format",
		label: "Format:",
		ignore: [ "missed" ],
		tabs: [ {
			key: "org", label: "Org",
		}, {
			key: "object", label: "Meta as JSON",
		}, {
			key: "org-protocol", label: "org-protocol",
		} ],
	});
	fragment.append(formatSwitcher.dom);

	const formatTabs = new (
		store.connect(
			function lrFormatTabsStateToProps(state) {
				return { active: state && state.transport && state.transport.format || "missed" };
			},
		)(LrTabGroup)
	)({ tabs: [
		{
			name: "missed",
			dom: new LrNoCaptureTab().dom,
		},
		LrFormatTab.tab("org", store),
		LrFormatTab.tab("object", store),
		LrFormatTab.tab("org-protocol", store, { useOptions: true, longUrl: true }),
	] });
	fragment.append(formatTabs.dom);

	return fragment;
}

function lrPreviewMentionsOpen() {
	var mentionsDetails = byId("mentions");
	mentionsDetails.setAttribute("open", true);
}

function lrCreateMentionsView(store) {
	var mentionsDetails = byId("mentions");
	mentionsDetails.append(
		(new (store.connect(
			function lrMentionsQueryMapStateToProps(state) {
				return state.mentions && state.mentions.query;
			},
			function lrMentionsQueryMapDispatchToProps(dispatch) {
				return {
					onchange: nameValSrc => dispatch(gLrMentionsActions.mentionsQueryChanged(nameValSrc)),
					onexec: () => dispatch(function (dispatch, getState) {
						return gLrMentionsActions.mentionsExec(dispatch, () => getState().mentions);
					}),
				};
			},
		)(LrMentionsQuery))()).dom,
		(new (store.connect(
			function lrMentionsResultMapStateToProps(state) {
				return state.mentions && state.mentions;
			},
			function lrMentionsResultMapDispatchToProps(dispatch) {
				return {
					onclick: data => dispatch(function(dispatch, getState) {
						const action = gLrMentionsActions.visit(data);
						return action(dispatch, () => getState().mentions);
					}),
				};
			},
		)(LrMentionsResult))()).dom,
	);
}

function lrInitEventSources() {
	const permissionEvents = new LrPermissionsEvents();
	const stateStore = new LrStateStore(LrCombinedReducer(
		new Map([
			[ "permissions", lrPermissionsReducer ],
			[ "transport", lrExportReducer ],
			[ "capture", lrCaptureReducer ],
			[ "log", lrPreviewLogReducer ],
			[ "mentions", lrMentionsReducer ],
		]),
	), { transport: { method: "clipboard", format: "missed" }});
	stateStore.registerComponent(permissionEvents, null, dispatch => permissionEvents.subscribe(dispatch));
	return { permissionEvents, stateStore };
}

// Force switch to the opener tab on preview close (Firefox-only)
//
// Browser tends to switch to next tab instead because:
// - activation of an unrelated tab cleared `openerTabId`
//   of all tabs,
// - there are multiple tabs with `openerTabId` identical
//   to the property of the captured tab
//   (multiple links opened from the same page).
// The trick does not work in Firefox-115 ESR when page development tools
// pane is focused.
async function lrSetSuccessorTabId() {
	// Firefox-specific, Chromium-127 does not support `successorTabId`.
	// The following can not be used as a workaround for Chrome:
	// - switching tab to `openerTabId` in `beforeunload` listener
	//   since it may happen in response to page reload.
	// - overriding and restoring `openerTabId` for all tabs in response to
	//   `document` `visibilitychange` event since it is not fired
	//   on tab detaching.
	// I am against waking up this extension on every `tabs.onActivate`,
	// `tabs.onDetach`, etc. events.
	if (bapi.tabs.moveInSuccession === undefined) {
		return;
	}
	const { id, openerTabId, successorTabId, windowId }
		= await bapi.tabs.getCurrent?.() || {};
	// Try to not interfere with extensions that manages next tab after closing.
	if (!(id >= 0 && openerTabId >= 0 && successorTabId === bapi.tabs.TAB_ID_NONE)) {
		return;
	}
	let openerTab;
	try {
		openerTab = await bapi.tabs.get(openerTabId);
		if (!(openerTab?.id >= 0)) {
			return;
		}
	} catch (_ex) {
		// The tab has been closed.
		return;
	}
	if (windowId !== openerTab.windowId) {
		return;
	}
	await bapi.tabs.moveInSuccession?.([id], openerTabId);
}

async function lrPreviewMain(eventSources) {
	gLrPreview = lrInitEventSources();
	const store = gLrPreview.stateStore;
	const captureActions = byId('detailsCapture');

	try {
		const log = new (store.connect(
			function lrPreviewLogStateToProps(state) {
				return { items: state.log };
			}
		)(LrPreviewLog))();
		captureActions.parentNode.insertBefore(log.dom, captureActions);
	} catch (ex) {
		lrPreviewLogException(store, { message: "Action log init failure", error: ex });
	}

	try {
		new (store.connect(lrPmStateToTitleProps)(LrTitle))();
	} catch (ex) {
		lrPreviewLogException(store, { message: "Dynamic title init failure", error: ex });
	}

	try {
		lrpSetupSettingsHandler();
		lrpSetupHelpHandler();
	} catch (ex) {
		lrPreviewLogException(store, { message: "Settings button init failure", error: ex });
	}

	try {
		const captureView = lrCreateCaptureView(store);
		captureActions.appendChild(captureView);
	} catch (ex) {
		lrPreviewLogException(store, { message: "Capture UI init failure", error: ex });
	}

	try {
		lrCreateMentionsView(store);
	} catch (ex) {
		lrPreviewLogException(store, { message: "Mentions UI init failure", error: ex });
	}

	const dispatch = action => store.dispatch(action);

	try {
		await dispatch(lrWithTimeout(1000, async function lrPreviewGetSettings(dispatch) {
			const settings = await lr_common.sendMessage("settings.get");
			dispatch(gLrPreviewActions.settings(settings));
			const method = settings && settings["export.method"];
			if (method && method != "native-messaging") {
				dispatch(gLrPreviewActions.exportMethodSelected(method));
			}
			const backend = settings && settings["export.methods.nativeMessaging.backend"];
			if (backend) {
				dispatch(gLrMentionsActions.mentionsQueryChanged({
					name: "name",
					value: backend,
					source: "settings",
				}));
			}
		}));
	} catch (error) {
		lrPreviewLogException(store, { message: "Failed to get settings", error });
	}

	try {
		await dispatch(lrWithTimeout(1500, lrPreviewGetCapture));
	} catch (error) {
		lrPreviewLogException(store, { message: "A problem with the capture", error });
	}

	try {
		await lrSetSuccessorTabId();
	} catch (error) {
		Promise.reject(error);
	}
	return eventSources;
}

// for debug
var gLrPreview;

lrPreviewMain()
	.catch(error => {
		lrPreviewLogException(gLrPreview.stateStore, { message: "Preview init failure", error });
		throw error;
	});
