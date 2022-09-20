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

	async function _run(func, clickData, tab, params) {
		const tabPromise = tab && tab.id >= 0 ? tab : getActiveTab();
		async function lr_action_run_onError(error, executor) {
			if (
				typeof lr_actionlock !== undefined
				&& error instanceof lr_actionlock.LrActionLockCancelledError
			) {
				return;
			}
			try {
				gLrRpcStore.putExecInfo(executor.execInfo);
			} catch (ex) {
				console.error("lr_action_run_onError: put result to store %o", ex);
			}
			await lr_action_run_openPreview();
		}

		let previewOpen;

		async function lr_action_run_openPreview(previewTab, params) {
			if (previewOpen === PREVIEW) {
				return;
			}
			if (!previewTab || !(previewTab.id >= 0)) {
				try {
					previewTab = await tabPromise;
				} catch (ex) {
					console.error("lr_action_run_openPreview: getting tab %o", ex);
				}
			}
			previewOpen = await lr_action.openPreview(
				previewTab && previewTab.id >= 0 ? previewTab : tab, params);
			// TODO implement feedback from preview tab that capture
			// is received before unlock
			await new Promise((resolve) => setTimeout(() => resolve(), 500));
		}

		async function lr_action_onCompleted(result, executor) {
			const { preview, previewTab, previewParams, status } = result || {};

			// Check namely `false` to ensure preview in the case of unexpected returned value.
			if (preview !== false) {
				await lr_action_run_openPreview(previewTab, previewParams);
			}
			return status;
		}

		const retval = await lr_executor.run(
			{
				notifier: new lr_executor.LrBrowserActionNotifier(),
				oncompleted: { func: lr_action_onCompleted, },
				onerror: { func: lr_action_run_onError, },
				implicitResult: false,
			},
			func, clickData, tab, params);
		const error = retval && retval.exception;
		if (error && !lr_common.isWarning(error)) {
			throw error;
		}
	}

	async function _waitLock(executor) {
		await executor.waitLock();
		executor.step(
			{ errorAction: lr_executor.IGNORE_ERROR, },
			function storeResultToCache(executor) {
				gLrRpcStore.putExecInfo(executor.execInfo);
			});
	}

	function createMenu() {
		// The following snippet
		//
		//     bapi.runtime.onInstalled.addListener(lr_action._doCreateMenu);
		//
		// recommended in https://developer.chrome.com/docs/extensions/mv2/background_pages/
		// "Manage events with background scripts" (Manifest v2, v3 has the same snippet)
		// does no work in Firefox since event pages are not supported,
		// moreover due to Chrome bugs it may be unreliable when updates of disabled
		// extensions or private tabs are involved.
		// - https://crbug.com/388231
		//   388231 - chrome.runtime.onInstalled not run when extension is updated while its disabled
		// - https://crbug.com/264963
		//   264963 - chrome.runtime.onInstalled is not fired for incognito profiles in split mode
		// - https://crbug.com/389631 (closed, sync with android)
		//   389631 - runtime.onInstalled never fired
		// In addition either `contextMenus.removeAll` should be called or
		// existing items should be updated with some additional logic
		// during extension update.

		const manifest = bapi.runtime.getManifest();
		// `true` is default value when omitted, so identity test
		if (manifest.background.persistent !== false) {
			// Firefox
			console.log("lr_action.createMenu: run for persistent extension");
			return _doCreateMenu();
		}

		let menuCreated = false;
		bapi.runtime.onInstalled.addListener(async function lr_onInstalled_menu(details) {
			if (menuCreated) {
				console.log("lr_action.createMenu: onInstalled: created earlier");
				return;
			}
			console.log("lr_action.createMenu: onInstalled(%o)", details);
			try {
				await bapi.contextMenus.removeAll();
			} catch (ex) {
				console.error("lr_action.createMenu: onInstalled: ignored error: %o", ex);
			}
			lr_action._doCreateMenu();
			menuCreated = true;
		});

		// Try to deal with bugs, unsure if it is really necessary
		// since there is fallback with timeout below.
		bapi.runtime.onStartup.addListener(async function lr_onStartup_menu() {
			if (menuCreated) {
				console.log("lr_action.createMenu: onStartup: created earlier");
				return;
			}
			console.log("lr_action.createMenu: onStartup");
			try {
				await bapi.contextMenus.removeAll();
			} catch (ex) {
				console.error("lr_action.createMenu: onStartup: ignored error: %o", ex);
			}
			lr_action._doCreateMenu();
			menuCreated = true;
		});

		// Last resort when neither of listeners above invoked due to bugs.
		setTimeout(async function lr_createMenu_delayed() {
			// There is no point to check `menuCreated` since it is `false`
			// for resumed extension.
			console.log("lr_action.createMenu: delayed: checking...");
			try {
				await bapi.contextMenus.update("LR_FRAME_REMARK", {});
				// menu created.
				// TODO: Are there cases when after extension update
				// menu is not recreated, so versions for normal and incognito
				// contexts (separately) should be added to local storage?
				console.log("lr_action.createMenu: delayed: menu is ready");
				return;
			} catch (ex) {
				console.log("lr_action.createMenu: delayed: recreating due to check error: %o", ex);
			}
			try {
				await bapi.contextMenus.removeAll();
			} catch (ex) {
				console.error("lr_action.createMenu: delayed: ignored error: %o", ex);
			}
			lr_action._doCreateMenu();
			menuCreated = true;
		}, 333);
	}

	async function _doCreateMenu() {
		// Chrome bugs do not allow to just follow recommendations,
		// so log action to facilitate debugging.
		console.log("lr_action._doCreateMenu...");

		// Firefox-only extension. Click on not highlighted
		// (selected with Ctrl) tab captures just it.
		// Click on a highlighted tab initiates capture of all highlighted tabs.
		const hasTabMenu = "TAB" in bapi.contextMenus.ContextType;
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
				contexts: hasTabMenu ? [ "tab", "browser_action" ] : [ "browser_action" ],
				enabled: true,
				id: "LR_TAB",
				title: "Remark for highlighted tabs",
			},
			bapi.tabs.group && {
				contexts: [ "browser_action" ],
				enabled: true,
				id: "LR_TAB_GROUP",
				title: "Remark for tab group",
			},
			{
				contexts: [ "browser_action" ],
				enabled: true,
				id: "LR_PREVIEW",
				title: "Debug info",
			},
			{
				contexts: [ "browser_action" ],
				enabled: true,
				id: "LR_HELP",
				title: "LR Help", // TODO i18n
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
			if (item) {
				lr_action._createMenuItem(item);
			}
		}
	};

	function _createMenuItem(details, error_cb = null) {
		return bapi.contextMenus.create(details, function lrCreateMenuCallback() {
			if (bapi.runtime.lastError) {
				console.error("LR: createMenu %o %o", details, bapi.runtime.lastError);
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
				case "LR_HELP":
					await lr_action.openHelp(tab);
					break;
				case "LR_FRAME_REMARK":
					await lr_action._run(
						lr_action._singleTabAction, clickData, tab, { type: "frame" });
					break;
				case "LR_IMAGE_REMARK":
					await lr_action._run(
						lr_action._singleTabAction, clickData, tab, { type: "image" });
					break;
				case "LR_LINK_REMARK":
					await lr_action._run(
						lr_action._singleTabAction, clickData, tab, { type: "link" });
					break;
				case "LR_TAB":
					await lr_action._run(highlightedTabsAction, clickData, tab, null);
					break;
				case "LR_TAB_GROUP":
					await lr_action._run(tabGroupAction, clickData, tab, null);
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
			// Follow recommendation from
			// https://developer.chrome.com/docs/extensions/reference/tabs/#get-the-current-tab
			// however for query from background page or service worker
			// `currentWindow` should work like `lastFocusedWindow`.
			const tab = await bapi.tabs.query({lastFocusedWindow: true, active: true});
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

	/// Asks export permission and calls `_singleTabActionDo`.
	/// Called throgh `browserAction` listener and context menu
	/// items for frame (page), link, and image.
	async function _singleTabAction(clickData, tab, props, executor) {
		const { type, fromBrowserActionPopup } = props || {};
		const exportPermissionPromise = fromBrowserActionPopup ?
			Promise.resolve("skip, async call from popup") :
			lr_export.requestPermissions();
		// FIXME tab may be undefined here and `await` must not be added
		// before permission request.
		executor.notifier.startContext(tab, { default: true });
		executor.acquireLock(type || "Tab", fromBrowserActionPopup);
		await executor.step(
			{ result: true, errorAction: lr_executor.IGNORE_ERROR },
			async function lrWaitExportPermissionsPromise(promise) {
				return await promise;
			},
			exportPermissionPromise,
		);

		return await executor.step(
			lr_action._singleTabActionDo, clickData, tab, type, executor);
	}

	/// Skips permission request. Necessary due to branches of highlightedTabsAction.
	async function _singleTabActionDo(clickData, tab, type, executor) {
		// A hack to ensure that tab is known before opening preview window
		// for previous capture.
		let activeTabPromise = !(tab != null && tab.id >= 0) ? getActiveTab() : null;

		await lr_action._waitLock(executor);

		const target = lr_action.clickDataToTarget(clickData, tab, type);
		// In chromium-87 contextMenus listener gets
		// tab.id == -1 and tab.windowId == -1 for PDF files
		// For commands (shrotcuts) tab is `null`.
		const activeTab = activeTabPromise != null ? await activeTabPromise : tab;
		const params = { frameTab: tab || activeTab, windowTab: activeTab, target };
		return await executor.step(
			captureAndExportResult, activeTab, lrCaptureSingleTab, params, executor);
	};

	class _HighlightedTabBunch {
		constructor(tab) {
			this.tab = tab;
		}
		get isBunch() {
			return this.tab.highlighted;
		}
		async getArray() {
			return bapi.tabs.query({ highlighted: true, lastFocusedWindow: true });
		}
	}

	class _GroupedTabBunch {
		constructor(tab) {
			this.tab = tab;
		}
		get isBunch() {
			return this.tab.groupId >= 0;
		}
		async getArray() {
			return bapi.tabs.query({groupId: this.tab.groupId});
		}
	}

	async function highlightedTabsAction(clickData, tab, _props, executor) {
		// Hope, no `await` or `executor.step` is necessary
		return lr_action._tabBunchAction(
			clickData, tab, new _HighlightedTabBunch(tab), executor);
	}

	async function tabGroupAction(clickData, tab, _props, executor) {
		// Hope, no `await` or `executor.step` is necessary
		return lr_action._tabBunchAction(
			clickData, tab, new _GroupedTabBunch(tab), executor);
	}

	async function _tabBunchAction(clickData, tab, bunch, executor) {
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

		const isBunch = bunch.isBunch;
		executor.acquireLock(!isBunch ? "Tab" : "Tabs");
		if (!isBunch) {
			executor.notifier.startContext(tab, { default: true });
			if (!tab.active) {
				// In Firefox context menu may be invoked for a non-highlighted tab.
				// Capture just that tab.
				await bapi.tabs.update(tab.id, { active: true });
			}
			// TODO consider executor.waitPromise method
			await executor.step(
				{ result: true, errorAction: lr_executor.IGNORE_ERROR },
				async function lrWaitExportPermissionsPromise(promise) {
					return await promise;
				},
				exportPermissionPromise,
			);
			return await executor.step(
				lr_action._singleTabActionDo, clickData, tab, null, executor);
		}

		const permissionObject = { permissions: [ "tabs"] };
		const hasTabPermissionPromise = bapi.permissions.request(permissionObject);

		// User actions in response to permissions request or switching tab
		// may affect selection, so store current list of tabs to be captured.
		const selectedArray = await bunch.getArray();

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
			if (tab.id !== selectedArray[0].id) {
				console.error("_tabBunchAction: action tab != single tab in bunch", tab, selectedArray[0]);
			}
			// Directly capture the only selected tab, it is allowed due to "activeTab" permission.
			return await executor.step(
				lr_action._singleTabActionDo, clickData, tab, null, executor);
		}

		await executor.step(
			{ result: true, errorAction: lr_executor.IGNORE_ERROR },
			async function lrWaitExportPermissionsPromise(promise) {
				return await promise;
			},
			exportPermissionPromise
		);
		const hasPermission = await executor.step(
			{ result: true, errorAction: lr_executor.IGNORE_ERROR },
			async function lrWaitTabPermissionsPromise(promise) {
				return await promise;
			},
			hasTabPermissionPromise
		);

		await lr_action._waitLock(executor);

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
		const capture = await executor.step(
			{ result: true },
			async function capture() {
				return lr_tabframe.makeCapture(await executor.step(method, params, executor));
			}
		);
		executor.result = { capture };

		const checkUrlsResult = executor.result.mentions = await executor.step(
			{ errorAction: lr_executor.ERROR_IS_WARNING, result: true },
			async function checkKnownUrls(capture) {
				const { body } = capture.formats[capture.transport.captureId];
				const urlObj = lrCaptureObjectMapUrls(body);
				try {
					return await lr_native_export.mentions(urlObj, undefined, executor);
				} catch (ex) {
					if (ex instanceof lr_native_export.LrNativeAppNotConfiguredError) {
						return {
							mentions: "APP_NOT_CONFIGURED",
							// TODO consider executor.log method to have non-iterrupting
							// errors available from debug info page.
							error: lr_util.errorToObject(ex),
						};
					}
					throw ex;
				}
			},
			capture);

		executor.step(
			{ errorAction: lr_executor.ERROR_IS_WARNING },
			function warnKnownUrls(checkUrlsResult) {
				const { mentions } = checkUrlsResult || {};
				if (mentions == null) {
					throw new LrWarning("Internal error during check for known URLs");
				} else if (typeof mentions === "string") {
					const ignore = ["APP_NOT_CONFIGURED", "NO_MENTIONS", "UNSUPPORTED", "NO_PERMISSIONS"];
					if (!(ignore.indexOf(mentions) >= 0)) {
						throw new LrWarning(`Check for known URL error: ${mentions}`);
					}
				} else {
					throw new LrWarning("Known URL in the capture");
				}
			},
			checkUrlsResult);

		const error = executor.step(
			{ errorAction: lr_executor.ERROR_IS_WARNING, result: true },
			function captureErrorsAndWarnings(executor) {
				return lr_util.errorToObject(executor.totalError());
			},
			executor);

		return await executor.step(
			async function exportActionResult(capture, options, error, executor) {
				if (error != null) {
					options = { ...options, error };
				}
				return await lr_export.process(capture, options, executor);
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
		lr_action._run(lr_action._singleTabAction, onClickData, tab, null);
	}

	this.openPreview = async function(tab, params) {
		const { action } = params || {};
		const url = new URL(bapi.runtime.getURL("pages/lrp_preview.html"));
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
				// Not necessary in Firefox-95 but Chromium-95 adds the tab at the end otherwise.
				index: tab && tab.index >= 0 ? tab.index + 1 : undefined,
			})) && PREVIEW;
		} catch(ex) {
			console.warn("lr_action.openPreview: %o", ex);
			return await bapi.tabs.create({
				url: url.toString(),
			});
		}
	};

	async function openHelp(openerTab) {
		return await lr_action._openUniqueAddonPage("pages/lrp_help.html", openerTab);
	}

	async function openHelpEndpoint(_params, port) {
		return lr_action.openHelp(port && port.tab);
	}

	async function _openUniqueAddonPage(relativeURL, openerTab) {
		if (openerTab == null) {
			openerTab = await lr_action.getActiveTab();
		}
		const pageURL = bapi.runtime.getURL(relativeURL);
		if (openerTab.url && openerTab.url.startsWith(pageURL)) {
			return;
		}
		try {
			const tabs = await bapi.tabs.query({
				currentWindow: null, // `false` ignores tabs in the current window
				url: pageURL + "*",
			});
			let existingTab;
			if (tabs) {
				for (const tabCandidate of tabs) {
					if (
						openerTab == null || !(openerTab.windowId >= 0) ||
						openerTab.windowId === tabCandidate.windowId
					) {
						existingTab = tabCandidate;
						break;
					}
					existingTab = existingTab || tabCandidate;
				}
			}
			if (existingTab != null) {
				if (existingTab.windowId >= 0) {
					await bapi.windows.update(existingTab.windowId, {
						drawAttention: true,
						focused: true,
					});
				}
				return await bapi.tabs.update(existingTab.id, { active: true });
			}
		} catch (ex) {
			console.error("lr_action._openUniqueAddonPage: ignored error: %o", ex);
		}
		return await bapi.tabs.create({
			url: pageURL,
			openerTabId: openerTab && openerTab.id >= 0 ? openerTab.id : undefined,
			windowId: openerTab && openerTab.windowId >= 0 ? openerTab.windowId : undefined,
		});
	}

	this.openSettings = async function(tab) {
		try {
			return await bapi.runtime.openOptionsPage();
		} catch (ex) {
			console.error("lr_action.openSettings: runtime.openOptionsPage: %o", ex);
		}
		return await bapi.tabs.create({
			url: bapi.runtime.getURL("pages/lrp_settings.html"),
			openerTabId: tab && tab.id,
			windowId: tab && tab.windowId,
		});
	};

	/** To be invoked from UI pages. Does not ask for permission
	 * since works outside of user action context.
	 * Returns `undefined` but may throw exception. */
	async function captureCurrentTabEndpoint() {
		// `fromBrowserActionPopup`
		// - suppresses permissions requests,
		// - opening popup when aquiring lock.
		await lr_action._run(lr_action._singleTabAction, null, null, { fromBrowserActionPopup: true });
	}

	Object.assign(this, {
		createMenu,
		getActiveTab,
		captureCurrentTabEndpoint,
		openHelp,
		openHelpEndpoint,
		_GroupedTabBunch,
		_HighlightedTabBunch,
		_doCreateMenu,
		_createMenuItem,
		_openUniqueAddonPage,
		_run,
		_waitLock,
		_singleTabAction,
		_singleTabActionDo,
		_tabBunchAction,
		internal: { PREVIEW,
			getActiveTab,
		},
	});

	return this;
});
