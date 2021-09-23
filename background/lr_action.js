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

	async function _run(func, ...args) {
		function lr_action_run_putResultToStore(executor) {
			gLrRpcStore.putResult(executor.result);
		}

		let previewOpen;

		async function lr_action_run_openPreview(tab, params) {
			if (previewOpen === PREVIEW) {
				return;
			}
			// TODO obtain default tab from notifier
			previewOpen = await lr_action.openPreview(tab, params);
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
				oninit: {
					// Some export methods may succeed even when result store is broken.
					descriptor: { errorAction: lr_executor.IGNORE_ERROR },
					func: lr_action_run_putResultToStore,
				},
				oncompleted: { func: lr_action_onCompleted, },
				onerror: {
					func: async function lr_action_run_onerror(_executor) {
						await lr_action_run_openPreview();
					}
				},
			},
			func, ...args);
		const error = retval && retval.exception;
		if (error && !lr_common.isWarning(error)) {
			throw error;
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
					await lr_action._run(
						lr_action._singleTabAction, clickData, tab, "frame");
					break;
				case "LR_IMAGE_REMARK":
					await lr_action._run(
						lr_action._singleTabAction, clickData, tab, "image");
					break;
				case "LR_LINK_REMARK":
					await lr_action._run(
						lr_action._singleTabAction, clickData, tab, "link");
					break;
				case "LR_TAB":
					await lr_action._run(tabGroupAction, clickData, tab);
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

	/// Asks export permission and calls `_singleTabActionDo`.
	/// Called throgh `browserAction` listener and context menu
	/// items for frame (page), link, and image.
	async function _singleTabAction(clickData, tab, type, executor) {
		const exportPermissionPromise = lr_export.requestPermissions();
		executor.notifier.startContext(tab, { default: true });
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

	/// Skips permission request. Necessary due to branches of tabGroupAction.
	async function _singleTabActionDo(clickData, tab, type, executor) {
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
			{ errorAction: lr_executor.ERROR_IS_WARNING, result: true },
			async function checkKnownUrls(capture) {
				const { body } = capture.formats[capture.transport.captureId];
				const urlObj = lrCaptureObjectMapUrls(body);
				return lr_native_messaging.mentions(urlObj);
			},
			capture);

		executor.step(
			{ errorAction: lr_executor.ERROR_IS_WARNING },
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
		_run,
		_singleTabAction,
		_singleTabActionDo,
		internal: { PREVIEW,
			getActiveTab,
		},
	});

	return this;
});
