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

var lr_action = lr_util.namespace(lr_action, function lr_action() {
	var lr_action = this;
	const PREVIEW = "PREVIEW";
	for (const name of ["IGNORE_ERROR", "ERROR_IS_WARNING"]) {
		Object.defineProperty(lr_action, name, {
			get() { return name; },
		});
	}

	class LrExecutor {
		constructor(params) {
			const { notifier, parent } = params || {}
			this.notifier = notifier
			this.parent = parent
			this.debugInfo = [];
		}

		get result() {
			let top = this;
			for ( ; top.parent != null ; top = top.parent) {
				;
			}
			if (!top._result) {
				top._result = { debugInfo: top.debugInfo };
			}
			return top._result;
		}

		step(maybeDescr, ...funcAndArgs) {
			const [descr, func, args] = LrExecutor._normArgs(maybeDescr, ...funcAndArgs);
			if (lr_util.isAsyncFunction(func)) {
				return this._asyncStep(descr, func, ...args);
			}
			this.debugInfo.push(descr);
			const saveResult = descr.result;
			if (saveResult) {
				descr.result = null;
			}
			try {
				if (!lr_util.isFunction(func)) {
					throw new TypeError("LrExecutor.step: not a function");
				}
				args.push(this);
				const result = func(...args);
				if (saveResult) {
					descr.result = result;
				}
				return result;
			} catch (ex) {
				this._onException(descr, ex);
			}
		}

		async _asyncStep(descr, func, ...args) {
			this.debugInfo.push(descr);
			const saveResult = descr.result;
			if (saveResult) {
				descr.result = null;
			}
			try {
				args.push(this);
				const result = await func(...args);
				if (saveResult) {
					descr.result = result;
				}
				return result;
			} catch (ex) {
				this._onException(descr, ex);
			}
		}

		child(maybeDescr, ...funcAndArgs) {
			let [fullDescr, func, args] = LrExecutor._normArgs(maybeDescr, ...funcAndArgs);
			const { contextId, contextObject, ...descr } = fullDescr;
			const notifier = this.notifier.makeNested({ id: contextId, object: contextObject });
			const child = new LrExecutor({ parent: this, notifier, });
			args.push(child);
			let finalize = 1;
			const child_copyError = (result, ex) => {
				--finalize;
				if (!(finalize > 0)) {
					child.finalized = true;
					const error = child.ownError();
					if (error) {
						if (typeof this._errors === 'undefined') {
							this._errors = this._errors;
							this._aggregateError = new LrTmpAggregateError(this._errors);
						}
						this._errors.push(error);
					}
					notifier.error(ex || error);
				}
				return result;
			};
			try {
				if (lr_util.isAsyncFunction(func)) {
					++finalize;
					return this._asyncStep({ children: child.debugInfo, ...descr }, func, ...args)
						.then(child_copyError, ex => {
							child_copyError(undefined, ex);
							throw ex;
						});
				}
				return this.step({ children: child.debugInfo, ...descr }, func, ...args);
			} finally {
				child_copyError();
			}
		}

		totalError() {
			try {
				let error = null;
				for (let executor = this; executor != null; executor = executor.parent) {
					if (executor._errors == null) {
						continue;
					}
					const curError = ((error !== null ? 1 : 0) + executor._errors.length) === 1 ?
						executor._errors[0] : executor._aggregateError;
					if (error == null) {
						error = curError;
						continue;
					}
					if (curError.errors == null) {
						error = new LrTmpAggregateError([curError, error]);
					} else {
						const newError = Object.create(curError);
						newError.errors = curError.slice();
						newError.errors.push(error);
						error = newError;
					}
				}
				return error;
			} catch (ex) {
				// TODO notify: global warning
				console.error("LrExecutor.totalError: internal error: %o", ex);
			}
		}

		ownError() {
			try {
				if (this._errors == null) {
					return this._errors;
				} else if (this._errors.length === 1) {
					return this._errors[0];
				}
				return this._aggregateError.fix();
			} catch (ex) {
				// TODO notify: global warning
				console.error("LrExecutor.ownError: internal error: %o", ex);
			}
		}

		_onException(descr, ex) {
			try {
				descr.error = this._lastError !== ex ? lr_util.errorToObject(ex) : true;
				switch(descr.errorAction) {
					case lr_action.ERROR_IS_WARNING:
						console.warn("LrExecutor: %o %o", descr.step, ex);
						if (this._errors === undefined) {
							this._errors = [];
							this._aggregateError = new LrTmpAggregateError(this._errors);
						}
						let warn = ex;
						if (!lr_common.isWarning(ex)) {
							if (ex.errors) {
								ex.toWarning();
							} else {
								warn = new LrWarning(undefined, { cause: ex });
							}
						}
						this._errors.push(warn);
						return;
					case lr_action.IGNORE_ERROR:
						return;
					default:
						break;
				}
				this._lastError = ex;
				if (this.parent != null) {
					this.parent._lastError = ex;
				}
				if (this.finalized) {
					console.error("LrExecutor: exception in completed instance: %o %o", ex, descr)
				}
			} catch (e) {
				console.error("LrExecutor internal error: %o %o", e, ex);
			}
			throw ex;
		}
	}

	LrExecutor._normArgs = function(func, ...args) {
		let descr;
		if (!lr_util.isFunction(func) && !lr_util.isAsyncFunction(func)) {
			descr = func;
			func = args.shift();
		}
		descr = descr || {};
		descr.step = descr.step || (func && func.name);
		return [descr, func, args];
	};

	function run(maybeDescr, ...funcAndArgs) {
		const [descr1, func, args] = LrExecutor._normArgs(maybeDescr, ...funcAndArgs);
		let { notifier, ...descr } = descr1;
		notifier = notifier || new LrExecutorNotifier();
		const executor = new LrExecutor({ notifier });
		try {
			executor.step(function putResultToStore(executor) {
				gLrRpcStore.putResult(executor.result);
			}, executor);
		} catch(ex) {
			// Some export methods may succeed even when result store is broken.
			console.error("lr_action.run: trying to ignore error: %o", ex);
		}

		function run_openPreview(tab, params) {
			// TODO obtain default tab from notifier
			lr_action.openPreview(tab, params);
		}

		function run_setTotalError(ex) {
			try {
				const warnings = executor.totalError();
				if (warnings != null) {
					if (ex == null) {
						ex = warnings;
					} else if (warnings instanceof LrTmpAggregateError) {
						warnings.errors.push(ex);
						ex = warnings;
					} else {
						ex = new LrAggregateError([ex, warnings]);
					}
				}
			} catch (e) {
				console.error("lr_action.run.setTotalError: %o", e);
			}
			try {
				if (ex) {
					executor.result.error = lr_util.errorToObject(ex);
				}
			} catch (e) {
				console.error("lr_action.run.saveTotalError: %o", e);
			}
			return ex;
		}
		async function onError(ex) {
			ex = run_setTotalError(ex);
			await run_openPreview();
			if (notifier) {
				notifier.error(ex);
			}
			throw ex;
		}
		async function onCompleted(result) {
			const ex = run_setTotalError();
			const { preview, previewTab, previewParams, status } = result || {};

			// Check namely `false` to ensure preview in the case of unexpected returned value.
			if (preview !== false) {
				await run_openPreview(previewTab, previewParams);
			}
			if (notifier) {
				switch (status) {
					case null: // fall through
					case undefined:
						if (ex == null) {
							notifier.completed(result);
						} else {
							notifier.error(ex);
						}
						break;
					case "success":
						notifier.completed(result);
						break;
					case "preview": // fall through
					case "warning":
						notifier.error(new LrWarning("Export is not completely successful"));
						break;
					default:
						console.warn("Unsupported export status: %o", status);
						notifier.error(new LrWarning("Unsupported export status"));
				}
			}
			executor.finalized = true;
			return result;
		}

		try {
			// actually async
			notifier.start();
			args.push(executor)
			if (lr_util.isAsyncFunction(func)) {
				return executor._asyncStep(descr, func, ...args)
					.then(onCompleted).catch(onError);
			}
			const result = executor.step(descr, func, ...args);
			if (lr_util.has(result, "then")) {
				return executor._asyncStep(descr, async function waitPromise(promise) {
					try {
						const result = await promise;
						return await onCompleted(result);
					} catch (ex) {
						return onError(ex);
					}
				}, result);
			}
			return onCompleted(result);
		} catch (ex) {
			onError(ex);
		}
	};

	class LrExecutorNotifier {
		constructor() {
			this.tabs = new Map();
			this.contextObjects = new WeakMap();
		}
		async start(params) {
			return await this.startContext(null, params);
		}
		async startContext(tab, params) {
			try {
				let tabId, url;
				if (tab == null) {
					tabId = null;
				} else {
					({ id: tabId, url } = tab);
					if (!(tabId >= 0)) {
						throw new Error("Invalid tab.id");
					}
					if (!url) {
						console.log("LrExecutorNotifier.startContext: missed tab.url, maybe no tabs permissions: %o", tab);
					}
				}
				const context = this.tabs.get(tabId);
				if (context != null) {
					const { state } = context;
					if (state === lr_notify.state.WARNING || state === lr_notify.state.ERROR) {
						console.error("LrExecutorNotifier.startContext: tab %o already failed", tabId);
					} else {
						console.warn("LrExecutorNotifier.startContext: tab %o state %o has been set earlier", tabId, state);
					}
					return;
				}
				const state = lr_notify.state.PROGRESS;
				this.tabs.set(tabId, { state, url });

				if (params && params.default) {
					if (tab == null) {
						throw new Error("No tab specified for default context");
					}
					if (this.defaultContext != null) {
						throw new Error("Default context already set");
					}
					this.defaultContext = tabId;
				}

				return lr_notify.notify({ tabId, state });
			} catch (ex) {
				console.error("LrExecutorNotifier.startContext: ignored error: %o %o %o", ex, tab, params);
			}
		}

		makeNested({ id: contextId, object: contextObject }) {
			if (contextId !== undefined && contextObject !== undefined) {
				console.warn("LrExecutorNotifier.makeNested: both contextId and contextObject are specified");
			}
			if (contextId != null) {
				if (!this.tabs.has(contextId)) {
					console.warn("LrExecutorNotifier.makeNested: unknown contextId: %o", contextId);
				} else {
					return Object.assign(Object.create(this), { defaultContext: contextId, nested: true });
				}
			}
			if (contextObject != null) {
				const mappedContext = this.contextObjects.get(contextObject);
				if (mappedContext == null) {
					console.warn("LrExecutorNotifier.makeNested: unknown contextObject: %o", contextObject);
				} else {
					return Object.assign(Object.create(this), { defaultContext: mappedContext, nested: true });
				}
			}
			if (contextId !== undefined || contextObject !== undefined) {
				console.warn("LrExecutorNotifier.makeNested: unknown arguments: %o %o", contextId, contextObject);
			}
			return this;
		}

		async error(error) {
			try {
				if (error == null) {
					return;
				}
				const parent = this.nested && this.defaultContext != null &&
					Object.getPrototypeOf(this);
				if (parent && this.defaultContext === parent.defaultContext) {
					return;
				}
				const isWarning = lr_common.isWarning(error);
				const newState = lr_notify.state[isWarning ? "WARNING" : "ERROR"];
				const tabs = this.nested && this.defaultContext != null ?
					[[ this.defaultContext, this.tabs.get(this.defaultContext)]] : this.tabs;
				const promises = []
				for (const [id, t] of tabs) {
					const { state: currentState, url } = t;
					if (!this._checkUrl(id, url)) {
						continue;
					}
					const state = (
						currentState === lr_notify.state.PROGRESS ||
						newState === lr_notify.state.ERROR
					) ? newState : currentState;
					promises.push(lr_notify.notify({ state, tabId: id }));
					if (this.defaultContext != null) {
						this.tabs.set(id, { ...t, state });
					}
				}
				await Promise.all(promises);
			} catch (ex) {
				// TODO report to executor?
				console.error("LrExecutorNotifier: ignore error: %o", ex);
			}
		}
		async completed(_result) {
			try {
				const success = Array.from(this.tabs.values())
					.every(x => (x && x.state) === lr_notify.state.PROGRESS);
				const state = success ? lr_notify.state.SUCCESS : lr_notify.state.WARNING;
				const promises = [];
				for (const [tabId, { state: tabState, url }] of this.tabs) {
					if (tabState === lr_notify.state.PROGRESS && this._checkUrl(tabId, url)) {
						// Error should be apparent from any tab,
						// success should be only shown for captured tabs.
						promises.push(lr_notify.notify({
							tabId,
							state: tabId != null || !success ? state : lr_notify.state.NOTHING,
						}));
					}
				}
				try {
					await Promise.all(promises);
				} catch (ex) {
					console.error("LrExecutorNotifier.completed: ignore notifier error: %o", ex);
				}
			} catch (ex) {
				this.error(ex);
				throw ex;
			}
		}

		async _checkUrl(tabId, url) {
			try {
				if (!(tabId >= 0) || !url) {
					return true;  // global notification or no tabs permission
				}
				const tab = await bapi.tabs.get(tabId);
				return tab.url === url;
			} catch (ex) {
				console.error(
					"LrExecutorNotifier._checkUrl(%o, %o): ignored error: %o",
					tabId, url, ex);
			}
			return true;
		}
	}

	this.createMenu = function() {
		const itemArray = [
			{
				contexts: [ "all" ],
				enabled: true,
				id: "LR_FRAME_REMARK",
				// custom commands do not work here
				// command: "page_remark",
				title: "Remark for the page",
			},
			{
				contexts: [ "browser_action" ],
				enabled: true,
				id: "LR_SETTINGS",
				title: "Settings",
			},
			{
				contexts: [ "browser_action" ],
				enabled: true,
				id: "LR_PREVIEW",
				title: "Debug info",
			},
			{
				contexts: [ "image" ],
				id: "LR_IMAGE_REMARK",
				title: "Remark for this image",
			},
			{
				contexts: [ "link" ],
				id: "LR_LINK_REMARK",
				title: "Remark for this link",
			},
		];
		for (const item of itemArray) {
			lr_action.createMenuItem(item);
		}

		// Firefox-only extension. Click on not highlighted
		// (selected with Ctrl) tab captures just it.
		// Click on a highlighted tab initiates capture of all highlighted tabs.
		if ("TAB" in bapi.contextMenus.ContextType) {
			lr_action.createMenuItem({
				contexts: [ "tab" ],
				enabled: true,
				id: "LR_TAB",
				title: "Remark for this or highlighted tab(s)",
			});
		}
	};

	this.createMenuItem = function(details, error_cb = null) {
		return bapi.contextMenus.create(details, function lrCreateMenuCallback() {
			if (bapi.runtime.lastError) {
				console.error("LR: createMenu", details, bapi.runtime.lastError);
			}
			if (error_cb) {
				error_cb();
			}
		});
	};
	
	this.contextMenuListener = async function(clickData, tab) {
		// TODO avoid async due to
		// https://bugzilla.mozilla.org/1398672
		//
		// clickData.viewType[extension.ViewType]: "tab" for page, "popup", "sidebar",
		// undefined for browserAction
		try {
			switch (clickData.menuItemId) {
				case "LR_PREVIEW":
					await lr_action.openPreview(tab);
					break;
				case "LR_SETTINGS":
					await lr_action.openSettings(tab);
					break;
				case "LR_FRAME_REMARK":
					await run(singleTabAction, clickData, tab, "frame");
					break;
				case "LR_IMAGE_REMARK":
					await run(singleTabAction, clickData, tab, "image");
					break;
				case "LR_LINK_REMARK":
					await run(singleTabAction, clickData, tab, "link");
					break;
				case "LR_TAB":
					await run(tabGroupAction, clickData, tab);
					break;
				default:
					throw new Error("Unknown menu item");
					break;
			}
		} catch (ex) {
			console.error("LR: contextMenuListener error", clickData, tab);
			throw ex;
		}
	};

	this.clickDataToTarget = function(clickData, tab, type) {
		const {
			pageUrl, frameId, frameUrl,
			selectionText, linkText, linkUrl, mediaType, srcUrl,
			targetElementId,
		} = clickData || {};
		return {
			tabId: tab && tab.id,
			pageUrl, frameId, frameUrl,
			selectionText, linkText, linkUrl, mediaType, srcUrl,
			targetElementId,
			captureObject: type,
		};
	};

	async function getActiveTab() {
		try {
			const tab = await bapi.tabs.query({currentWindow: true, active: true});
			const activeTab = tab != null && tab.length > 0 ? tab[0] : null;
			if (activeTab) {
				return activeTab;
			}
			console.error("lrGetActiveTab: empty query result");
		} catch (ex) {
			console.error("lrGetActiveTab: error:", ex);
		}
		return null;
	}

	/// Asks export permission and calls `singleTabActionDo`.
	/// Called throgh `browserAction` listener and context menu
	/// items for frame (page), link, and image.
	async function singleTabAction(clickData, tab, type, executor) {
		const exportPermissionPromise = lr_export.requestPermissions();
		executor.notifier.startContext(tab, { default: true });
		await executor.step(
			{ result: true, errorAction: lr_action.IGNORE_ERROR },
			async function lrWaitExportPermissionsPromise(promise) {
				return await promise;
			},
			exportPermissionPromise,
		);
		return await executor.step(
			singleTabActionDo, clickData, tab, type, executor);
	}

	/// Skips permission request. Necessary due to branches of tabGroupAction.
	async function singleTabActionDo(clickData, tab, type, executor) {
		const target = lr_action.clickDataToTarget(clickData, tab, type);
		// In chromium-87 contextMenus listener gets
		// tab.id == -1 and tab.windowId == -1 for PDF files
		// For commands (shrotcuts) tab is `null`.
		const activeTab = tab && tab.id >= 0 ? tab : await getActiveTab();
		const params = { frameTab: tab || activeTab, windowTab: activeTab, target };
		return await executor.step(
			captureAndExportResult, activeTab, lrCaptureSingleTab, params, executor);
	};

	async function tabGroupAction(clickData, tab, executor) {
		// Firefox-87:
		// Do not `await` anything before `permissions.request`, otherwise
		// user action context is lost, see
		// https://bugzilla.mozilla.org/1398833
		// It would be nice to count highlighted tabs in advance
		// and do not request permissions for a single tab:
		//
		//     const selectedArray = await bapi.tabs.query({highlighted: true});
		//
		// Accordingly to comments to the bug reports, there is no point to call
		//
		//     let hasPermission = await bapi.permissions.contains(permissionObject);
		// 
		// before since popup does not appear if permissions have been granted already.
		// Firefox-89 uses stack of permission requests, not queue, ask them
		// in reverse order.

		const exportPermissionPromise = lr_export.requestPermissions();

		if (!tab.highlighted) {
			executor.notifier.startContext(tab, { default: true });
			// Tab is neither active nor selected (highlighted). Capture just that tab.
			await bapi.tabs.update(tab.id, { active: true });
			// TODO consider executor.waitPromise method
			await executor.step(
				{ result: true, errorAction: lr_action.IGNORE_ERROR },
				async function lrWaitExportPermissionsPromise(promise) {
					return await promise;
				},
				exportPermissionPromise,
			);
			return await executor.step(
				singleTabActionDo, clickData, tab, null, executor);
		}

		const permissionObject = { permissions: [ "tabs"] };
		const hasTabPermissionPromise = bapi.permissions.request(permissionObject);

		// User actions in response to permissions request or switching tab
		// may affect selection, so store current list of tabs to be captured.
		const selectedArray = await bapi.tabs.query({highlighted: true});

		if (!tab.active) {
			// Firefox-87: Prompt is hidden till user switches to the tab
			// https://bugzilla.mozilla.org/1679925
			// so switch to the clicked tab.
			// TODO: Do it with timeout only if the permission has not been granted yet.
			// Popup may be still hidden if cursor is in the **empty** URL bar
			// https://bugzilla.mozilla.org/1707868
			await bapi.tabs.update(tab.id, { active: true });
		}

		if (selectedArray.length === 1) {
			executor.notifier.startContext(tab, { default: true });
			// Directly capture the only selected tab, it is allowed due to "activeTab" permission.
			return await executor.step(
				singleTabActionDo, clickData, tab, null, executor);
		}

		await executor.step(
			{ result: true, errorAction: lr_action.IGNORE_ERROR },
			async function lrWaitExportPermissionsPromise(promise) {
				return await promise;
			},
			exportPermissionPromise
		);
		const hasPermission = await executor.step(
			{ result: true, errorAction: lr_action.IGNORE_ERROR },
			async function lrWaitTabPermissionsPromise(promise) {
				return await promise;
			},
			hasTabPermissionPromise
		);

		selectedArray.forEach(selectedTab => executor.notifier.startContext(selectedTab));
		const tabTargets = [];
		for (const selectedTab of selectedArray) {
			if (tab.id === selectedTab.id) {
				// `selectedTab.url` may be empty if permission was not obtained earlier.
				tabTargets.push({
					frameTab: tab,
					windowTab: tab,
					target: lr_action.clickDataToTarget(tab, clickData, null),
				});
			} else if (!hasPermission || selectedTab.url) {
				tabTargets.push({
					frameTab: selectedTab,
					windowTab: selectedTab,
				});
			} else {
				// While obtaining the list of selected tab we might not have permissions,
				// so try to get url and title again.
				const tab = await bapi.tabs.get(selectedTab.id);
				tabTargets.push({ frameTab: tab, windowTab: tab });
			}
		};
		return await executor.step(captureAndExportResult, tab, lrCaptureTabGroup, tabTargets, executor);
	}

	async function captureAndExportResult(activeTab, method, params, executor) {
		const capture = executor.result.capture = await executor.step(
			{ result: true },
			async function capture() {
				return lr_tabframe.makeCapture(await executor.step(method, params, executor));
			}
		);

		const checkUrlsResult = executor.result.mentions = await executor.step(
			{ errorAction: lr_action.ERROR_IS_WARNING, result: true },
			async function checkKnownUrls(capture) {
				const { body } = capture.formats[capture.transport.captureId];
				const urlObj = lrCaptureObjectMapUrls(body);
				return lr_native_messaging.mentions(urlObj);
			},
			capture);

		executor.step(
			{ errorAction: lr_action.ERROR_IS_WARNING },
			function warnKnownUrls(checkUrlsResult) {
				const { mentions } = checkUrlsResult || {};
				if (mentions == null) {
					throw new LrWarning("Internal error during check for known URLs");
				} else if (typeof mentions === "string") {
					if (!(["NO_MENTIONS", "UNSUPPORTED", "NO_PERMISSIONS"].indexOf(mentions) >= 0)) {
						throw new LrWarning(`Check for known URL error: ${mentions}`);
					}
				} else {
					throw new LrWarning("Known URL in the capture");
				}
			},
			checkUrlsResult);

		const error = executor.step(
			{ errorAction: lr_action.ERROR_IS_WARNING, result: true },
			function captureErrorsAndWarnings(executor) {
				return lr_util.errorToObject(executor.totalError());
			},
			executor);

		return await executor.step(
			async function exportActionResult(capture, options, error) {
				if (error != null) {
					options = { ...options, error };
				}
				return await lr_export.process(capture, options);
			},
			capture, { tab: activeTab }, error);
	}

	this.commandListener = function(command) {
		// Unused for a while.
		// - `_execute_browser_action` is not fired at all,
		//   it is processed through `browserAction.onClicked`
		// - `command: "page_remark"` with user custom commands
		//   is unsupported in context menu descriptors.
		throw new Error(`Unsupported command ${command}`);
	};

	this.browserActionListener = function(tab, onClickData) {
		/* Call async function through a wrapper to get error in extension
		 * dev tools in Firefox that otherwise reported to browser console.
		 * Absence of `console.error` allows to avoid duplicated error in Chrome.
		 * Workaround for:
		 * https://bugzilla.mozilla.org/1398672
		 * "1398672 - Add test for better logging of exceptions/rejections from async event"
		 */
		/* onClickData is a firefox-72 feature that should be handy
		 * to support additional actions with Shift or Ctrl
		 * but it is unsupported by other browsers
		 * https://bugzilla.mozilla.org/1405031
		 * "Support additional click events for browserAction and pageAction"
		 */
		run(singleTabAction, onClickData, tab, null);
	}

	this.openPreview = async function(tab, params) {
		const { action } = params || {};
		const url = new URL(bapi.runtime.getURL("pages/preview.html"));
		if (action) {
			const query = new URLSearchParams();
			query.set("action", action);
			url.search = query.toString();
		}
		// Firefox-88 for `openerTabId: -1`:
		//     Type error for parameter createProperties (Error processing openerTabId:
		//     Integer -1 is too small (must be at least 0)) for tabs.create
		try {
			return (await bapi.tabs.create({
				url: url.toString(),
				openerTabId: tab && tab.id >= 0 ? tab.id : undefined,
				windowId: tab && tab.windowId >= 0 ? tab.windowId : undefined,
			})) && PREVIEW;
		} catch(ex) {
			console.warn("lr_action.openPreview: %o", ex);
			return await bapi.tabs.create({
				url: url.toString(),
			});
		}
	};

	this.openSettings = async function(tab) {
		try {
			return await bapi.runtime.openOptionsPage();
		} catch (ex) {
			console.error("lr_action.openSettings: runtime.openOptionsPage: %o", ex);
		}
		return await bapi.tabs.create({
			url: bapi.runtime.getURL("pages/settings.html"),
			openerTabId: tab && tab.id,
			windowId: tab && tab.windowId,
		});
	};

	Object.assign(this, {
		tabGroupAction,
		internal: { PREVIEW, LrExecutor, LrExecutorNotifier, run,
			getActiveTab,
		},
	});

	return this;
});
