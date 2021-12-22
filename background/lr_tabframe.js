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

var lr_tabframe = lr_util.namespace(lr_tabframe, function lr_tabframe() {
	const lr_tabframe = this;

	const FORMAT = "object";
	const VERSION = "0.2";

	lr_tabframe.scriptTimeout = 2000;

	function makeCapture(result) {
		const id = result.id || bapiGetId();
		return {
			formats: { [id]: {
				...result,
				id,
				format: FORMAT,
				version: VERSION,
			} },
			transport: {
				captureId: id,
			},
		};
	}

	Object.assign(this, {
		FORMAT, VERSION,
		makeCapture,
	});
});

function spliceFrameChains(frameMap, chainMap) {
	const listSize = frameMap.size;
	for (let chain of chainMap.values()) {
		if (!(chain.length > 0)) {
			continue;
		}
		for (let i = 0; i <= listSize; ++i) {
			const lastParentId = chain[chain.length - 1].frame.parentFrameId;
			// FIXME should topFrame be added if lastParentId == null ?
			if (lastParentId === -1 || lastParentId == null) {
				break;
			}
			const parentChain = chainMap.get(lastParentId);
			if (parentChain != null && parentChain.length > 0) {
				chain.concat(parentChain.splice(0));
			} else {
				//assert parentChain != null
				const parentFrame = frameMap.get(lastParentId);
				if (parentFrame) {
					chain.push(parentFrame);
				} else {
					const topFrame = frameMap.get(0);
					console.warn('Incomplete chain parentId=', lastParentId);
					if (topFrame != null) {
						chain.push(topFrame);
					}
					break;
				}
			}
			if (i == listSize) {
				console.error('Likely infinite loop due to incorrect parentFrameId');
				break;
			}
		}
	}
}

/** Restore chain of frames having focus from potentially incomplete
 * list of frameInfo objects
 */
function focusedFrameChain(frameMap) {
	if (!frameMap || !(frameMap.size > 0)) {
		return;
	}
	const chainMap = new Map();
	const activeOptions = new Set(['EMBED', 'IFRAME', 'FRAME']);
	for (const frameInfo of frameMap.values()) {
		const {frameId} = frameInfo.frame;
		// assert !frameMap.has(frameId)
		const { summary } = frameInfo;
		if (summary && (summary.hasFocus || activeOptions.has(summary.activeElementNode))) {
			chainMap.set(frameId, [frameInfo]);
		}
	}

	if (!(chainMap.size > 0)) {
		// Not an error, no frames have focus or executed on a privileged page
		return [ frameMap.get(0) ];
	}

	spliceFrameChains(frameMap, chainMap);

	let longestChain = null;
	for (const chain of chainMap.values()) {
		if (!(chain.length > 0)) {
			continue;
		}
		if (longestChain == null) {
			longestChain = chain;
		} else {
			console.warn('ambiguous frame chain %o %o', chain, longestChain);
			if (chain.length > longestChain.length) {
				longestChain = chain;
			}
		}
	}
	if (longestChain == null || !(longestChain.length > 0)) {
		console.error('empty longest chain');
	} else if (longestChain[longestChain.length - 1].frame.frameId != 0) {
		console.warn('top frameId=%o is not 0', longestChain[longestChain.length - 1].frame.frameId);
	}
	return longestChain;
}

/**
 * Nothrow wrapper for `webNavigation.getAllFrames()`
 *
 * If I remember correctly, in the beginning of 2020 empty list of frames
 * were returned for the extensions page in chromium.
 * Chromium-87 gives single frame. Currently Firefox and Chromium
 * returns single frame for PDF view, src view, config pages.
 *
 * Exception likely may be thrown if `webNavigation` permission is not granted.
 * TODO Consider making `webNavigation` permission optional.
 * At least into non-privileged pages a content script could be injected
 * that sends a message, so `frameId` could be obtained from the sender object.
 * However I have no idea how to get `parentFrameId` to build frame tree.
 */
async function lrGetAllFrames(tab) {
	// Likely redundant protection, tab should be valid here
	const tabId = tab != null ? tab.id : -1;
	if (!(tabId >= 0)) {
		// May happen in Chromium-87 when context menu is invoked for a PDF file
		// but should be handled by caller since <embed> element
		// in Chrome created for PDF file has its own "tab".
		return [];
	}
	let frames = await bapi.webNavigation.getAllFrames({tabId});
	// Chromium-95 returns `[]` for privileged pages as "chrome-extension://"
	// however it gives array with valid frame for "chrome://extensions"
	if (frames && frames.length >= 0) {
		return frames;
	}
	console.warn(
		"lrGetAllFrames: tab {id: %s, url=%s}: empty frames: %o",
		tabId, tab.url, frames);
	throw new LrWarning("Restricted page (unavailable frame list)");
}

/**
 * Create map `[frameId]: { frame: { frameId, url, parentFrameId} }`
 *
 * Objects will be augmented with other properties
 * obtained from content scripts.
 */
function lrMakeFrameMap(tab, frameArray) {
	const frameMap = new Map();
	for (const frame of frameArray) {
		frameMap.set(frame.frameId, {frame});
	}
	if (!frameMap.has(0)) {
		// No reasonable values for `processId`, `errorOccured`
		frameMap.set(0, { frame: {
			frameId: 0,
			tabId: tab.id,
			url: tab.url,
			parentFrameId: -1,
			synthetic: "LinkRemark fallback"
		}});
	}
	return frameMap;
}

function lrFormatFrameError(tab, wrappedFrame) {
	const frame = wrappedFrame && wrappedFrame.frame;
	const tabId = tab && tab.id;
	const frameId = frame && frame.frameId;
	const frameUrl = frame && frame.url;
	return `frame: {tabId: ${tabId}, frameId: ${frameId}, url: ${frameUrl}}`;
}

/** Check lack of permissions for content scripts on particular page
 * To avoid confusion with failure of invalid content script.
 * `permissions.contains({origins: [url]})` gives false positive for PDF files and reader mode.
 * Error reported by `tabs.executeScript` is not specific:
 * - Firefox-83:  "Missing host permission for the tab" no code, empty stack, undefined fileName. "[object Error]"
 * - Chromium-87: "Cannot access a chrome:// URL",
 * - Chromium-87: "Cannot access contents of the page. Extension manifest must request permission to access the respective host."
 * Its return value (array element) may be `undefined` on a privileged page in Firefox.
 * Try to eval simple code.
 */
async function lrCheckFrameScriptsForbidden(tab, wrappedFrame, executor) {
	const tabId = tab && tab.id;
	const frameId = wrappedFrame && wrappedFrame.frame && wrappedFrame.frame.frameId;

	async function lrExecutePermissionForbiddenCheckScript(tab, frameId, executor) {
		const tabId = tab && tab.id;
		if (!(tabId >= 0)) {
			return true;
		}
		try {
			const retvalArray = await bapi.tabs.executeScript(tabId, {
				code: "314",
				frameId,
				allFrames: false,
			});
			if (retvalArray && retvalArray[0] == 314) {
				return false;
			} else {
				// Firefox-93 about: tab has `retval === undefined`
				return true;
			}
		} catch (ex) {
			// Firefox-93: `<iframe>` empty, `sandbox`, or `src="data:..."`.
			// https://bugzilla.mozilla.org/1411641
			// "1411641 - CSP 'sandbox' directive prevents content scripts from matching..."
			// Chromium-95: (actually `runtime.lastError` and `undefined` as callback args)
			// for chrome: or chrome-extension: pages.
			const frameURL = wrappedFrame && wrappedFrame.frame && wrappedFrame.frame.url;
			console.debug(
				"lrCheckFrameScriptsForbidden: tab %o (%o) frame %o %o: content scripts are not allowed: %o",
				tabId, tab && tab.url, frameId, frameURL, ex);
			return true;
		}
		return null;
	}

	const summary = wrappedFrame.summary = wrappedFrame.summary || {};
	if (summary.scripts_forbidden == null) {
		summary.scripts_forbidden = await executor.step(
			{
				errorAction: lr_executor.ERROR_IS_WARNING,
				timeout: lr_tabframe.scriptTimeout,
			},
			lrExecutePermissionForbiddenCheckScript, tab, frameId
		);
		if (summary.scripts_forbidden == null) {
			// timeout
			summary.scripts_forbidden = true;
		}
	}
	return summary.scripts_forbidden;
}

/**
 * Set `wrappedFrame` `property` to result or error of `file` execution
 */
async function lrExecuteFrameScript(tab, wrappedFrame, file, property, executor) {
	try {
		if (wrappedFrame.summary && wrappedFrame.summary.scripts_forbidden) {
			return;
		}
		if (!(tab && tab.id >= 0)) {
			console.debug("lrExecuteFrameScript: skipping due to unknown tab.id, likely privileged content %o", tab);
			throw new LrWarning("Unknown tab.id. Privileged page?");
		}
		const retvalArray = await executor.step(
			{
				timeout: lr_tabframe.scriptTimeout,
				file
			},
			async function executeScriptInFrame() {
				return await bapi.tabs.executeScript(tab.id, {
					file: file,
					frameId: wrappedFrame.frame.frameId,
					allFrames: false,
				});
			});
		if (!retvalArray || !(retvalArray.length > 0)) {
			throw new LrWarning('tabs.executeScript got no result');
		}
		const retval = retvalArray[0];
		if (!retval) {
			throw new LrWarning('tabs.executeScript is likely called for a privileged frame');
		} else if (lr_util.has(retval, "result") || lr_util.has(retval, "error")) {
			wrappedFrame[property] = retval;
		} else {
			wrappedFrame[property] = { result: retval};
		}
	} catch (ex) {
		const error = lr_util.errorToObject(ex);
		// Workaround for Firefox (at least 83), in Chromium stack is generated by `bapi`
		if (!error.stack) {
			error.stack = (new Error()).stack;
			error.stack = error.stack && error.stack.trim().split("\n");
		}
		wrappedFrame[property] = { error };
		if (!(await lrCheckFrameScriptsForbidden(tab, wrappedFrame, executor))) {
			executor.addError(ex);
			console.error('lrExecuteFrameScript', lrFormatFrameError(tab, wrappedFrame), file, error);
		}
	}
	return wrappedFrame;
}

function lrFrameChainOrTopFrame(frameMap) {
	try {
		const chain = focusedFrameChain(frameMap);
		if (chain && chain.length > 0) {
			return chain;
		}
	} catch (ex) {
		console.error("lrFrameChainOrTopFrame: continue despite the error %s %o", ex, ex);
	}
	console.warn("lrFrameChainOrTopFrame: fallback to the top frame");
	// If fails, the error is fatal anyway
	return [frameMap.get(0)];
}

async function lrAsyncReportStep(func, collector, props=null) {
	try {
		const result = await func();
		if (collector != null && (props && props.result != null ? props.result : false)) {
			collector.push({ step: "" + (func && func.name), result });
		}
		return result;
	} catch (ex) {
		if (collector != null && (props && props.error != null ? props.error : true)) {
			collector.push({ step: "" + (func && func.name), error: lr_util.errorToObject(ex)});
		}
		if (collector != null && (props && props.catchException != null ? props.catchException : false)) {
			console.error(`LR: ${func && func.name}`, ex);
		} else {
			throw ex;
		}
	}
}

function lrReportStep(func, collector, props=null) {
	try {
		const result = func();
		if (collector != null && (props && props.result != null ? props.result : false)) {
			collector.push({ step: "" + (func && func.name), result });
		}
		return result;
	} catch (ex) {
		if (collector != null && (props && props.error != null ? props.error : true)) {
			collector.push({ step: "" + (func && func.name), error: lr_util.errorToObject(ex)});
		}
		if (collector != null && (props && props.catchException != null ? props.catchException : false)) {
			console.error(`LR: ${func && func.name}`, ex);
		} else {
			throw ex;
		}
	}
}

async function lrCaptureTabGroup(tabTargetArray, executor) {
	const promises = executor.step(function launchTabGroupCaptures(executor) {
		return tabTargetArray.map(tabTarget => {
			const tab = tabTarget && (tabTarget.windowTab || tabTarget.frameTab);
			return executor.child(
				{ contextId: tab && tab.id },
				lrCaptureSingleTab, tabTarget
				/* implicit childExecutor argument */);
		});
	});
	const { elements, errors } = await executor.step(async function waitTabGroupCaptures(executor) {
		let errors = [];
		let elements = [];
		for (const p of promises) {
			try {
				if (p) {
					const capture = await executor.step(
						{ result: true },
						async function waitSingleTabCapture(p) {
							return await p;
						}, p)
					elements.push(capture.body);
				}
			} catch (ex) {
				errors.push(ex);
			}
		}
		if (!(elements.length > 0)) {
			throw new Error(errors, "Capture failed for all tabs");
		}
		return { elements, errors };
	});

	executor.step(
		{ errorAction: lr_executor.ERROR_IS_WARNING },
		function checkTabGroupWarning(promises, elements, errors) {
			const failures = promises.length - elements.length;
			if (failures === 0) {
				return;
			}
			elements.unshift({ _type: "Text", elements: [ `Capture of ${failures} tabs failed` ] });
			if (errors.length === 0) {
				throw new LrWarning(`Capture of ${failures} tab failed`);
			} else if (errors.length === 1) {
				throw errors[0];
			}
			throw new LrAggregateWarning(errors, `Capture of ${failures} tabs failed`);
		},
		promises, elements, errors);

	return {
		title: "Tab Group", // i18n
		body: { _type: "TabGroup", elements },
	};
}

async function lrCaptureSingleTab({frameTab, windowTab, target}, executor) {
	// Firefox-95 may pass `undefined` as `TabData` on privileged pages
	// with reasonable `ClickData` however.
	if (!windowTab.url && !frameTab.url && !(target && target.pageUrl)) {
		throw new Error("Permission for a tab denied");
	}
	executor.step({ result: true }, function setTargetElement() {
		// Unavailable in Chrome
		if (target == null) {
			return "No target";
		}
		const { tabId, frameId, targetElementId } = target;
		if (!(targetElementId != null && tabId >= 0)) {
			return "No targetElementId or tabId";
		}
		gLrRpcStore.putTargetElement({tabId, frameId, targetElementId});
		return true
	});
	const frameChain = await executor.step(
		{ result: true },
		lrGatherTabInfo, frameTab, target, windowTab);
	const body = executor.step(function frameMergeMeta() {
		return {
			_type: "TabFrameChain",
			elements: frameChain.map(frame => lr_meta.merge(frame)),
		};
	});
	const { url, title } = frameTab;
	const tabCapture = { body, url, title, };
	executor.addContextObject(body);
	return tabCapture;
}

/**
 * If frameId is known (invoked from context menu handler)
 * then we could optimize a bit in comparison to `lrFrameChainGuessSelected()`
 * by avoiding queries to the most of frames if there are a lot of them on
 * the page.
 */
async function lrFrameChainByClickData(tab, frameMap, clickData, executor) {
	let { frameId } = clickData;
	const chain = [];
	let targetFrame = frameMap.get(frameId);
	if (targetFrame == null) {
		targetFrame = { frame: {
			frameId,
			tabId: clickData.tabId,
			url: clickData.frameUrl || clickData.pageUrl,
			parentFrameId: (frameId === 0 ? -1 : 0),
			synthetic: "clickData",
		}};
	}
	targetFrame.clickData = clickData;
	chain.push(targetFrame);
	frameId = targetFrame.frame.parentFrameId;
	while (frameId != -1) {
		const frame = frameMap.get(frameId);
		if (frame == null) {
			console.error("lrFrameChainByClickData: no frameId %s in the map", frameId);
			break;
		}
		chain.push(frame);
		frameId = frame.frame && frame.frame.parentFrameId;
	}
	const topFrame = frameMap.get(0);
	// for the case if top frame has not been reached for some obscure reason
	if (topFrame && (chain.length === 0 || chain[chain.length - 1] !== topFrame)) {
		chain.push(topFrame);
	}
	if (topFrame && topFrame.clickData == null && clickData.pageUrl) {
		topFrame.clickData = { url: clickData.pageUrl };
	}
	await lrExecRelationsScript(tab, frameMap.values(), executor);
	return chain;
}

async function lrExecRelationsScript(tab, frames, executor) {
	if (!Array.isArray(frames)) {
		// To allow second pass if iterator is passed
		frames = Array.from(frames);
	}

	try {
		await Promise.all(Array.from(
			frames,
			wrappedFrame => lrExecuteFrameScript(
				tab, wrappedFrame, "/content_scripts/lrc_relations.js", "relations", executor)
		));
	} catch (ex) {
		console.error("lrExecRelationsScript: continue despite the error %s %o", ex, ex);
	}
	for (const wrappedFrame of frames) {
		try {
			const relations = wrappedFrame.relations && wrappedFrame.relations.result;
			if (!relations) {
				continue;
			}
			const summary = wrappedFrame.summary = wrappedFrame.summary || {};
			for (const { property, key, value } of relations) {
				if (property !== "frame_relations") {
					continue;
				}
				switch (key) {
					case "document.hasFocus":
						summary.hasFocus = value;
						break;
					case "document.activeElement.nodeName":
						summary.activeElementNode = value;
						break;
					default:
						break;
				}
			}
		} catch (ex) {
			console.error("lrExecRelationsScript: %o: continue despite the error %s %o", wrappedFrame, ex, ex);
		}
	}
}

async function lrFrameChainGuessSelected(tab, frameMap, executor) {
	await lrExecRelationsScript(tab, frameMap.values(), executor);
	return lrFrameChainOrTopFrame(frameMap);
}

/**
 * clickData { frameId, captureObject[some fields of menus.OnClickData] }
 */
async function lrGatherTabInfo(tab, clickData, activeTab, executor) {
	const stepTimeout = { timeout: lr_tabframe.scriptTimeout };
	const frameId = clickData && tab && tab.id >= 0 ? clickData.frameId : null;
	// The only reason to call webNavigation.getFrame()
	// might be errorOccured property, but it is unused currently.
	// Fake top level frame will be added by lrMakeFrameMap.
	const frameArray = (
		frameId !== 0 && await executor.step(
			{ errorAction: lr_executor.ERROR_IS_WARNING, ...stepTimeout },
			lrGetAllFrames, activeTab)
	) || [];
	const frameMap = lrMakeFrameMap(activeTab, frameArray);
	console.assert(frameMap.has(0), "frameMap has at least synthetic frameId 0");
	frameMap.get(0).tab = {
		id: activeTab.id,
		url: activeTab.url,
		title: activeTab.title,
		favIconUrl: activeTab.favIconUrl
	};
	const chain = frameId != null ? await lrFrameChainByClickData(tab, frameMap, clickData, executor) :
		await lrFrameChainGuessSelected(activeTab, frameMap, executor);
	// Hope that checking here instead of `lrExecutePermissionForbiddenCheckScript`
	// allows to avoid noise due to e.g. empty `<iframe>` somewhere on the page.
	executor.step(
		{ errorAction: lr_executor.ERROR_IS_WARNING },
		function lrCheckFramePermissionsErrors(chain) {
			let count = 0;
			for (const wrappedFrame of chain) {
				if (wrappedFrame.summary && wrappedFrame.summary.scripts_forbidden) {
					++count;
				}
			}
			if (count > 0) {
				throw new LrWarning(`Frames with restricted access: ${count}`);
			}
		},
		chain);

	try {
		const scripts = [
			[ "/content_scripts/lrc_selection.js", "selection" ],
			[ "/content_scripts/lrc_meta.js", "meta" ],
			[ "/content_scripts/lrc_microdata.js", "microdata" ],
		];

		const metaPromises = [];
		for (const wrappedFrame of chain) {
			metaPromises.push(...scripts.map(script =>
				executor.step(lrExecuteFrameScript, activeTab, wrappedFrame, ...script)));
		}
		await Promise.all(metaPromises);
	} catch (ex) {
		// FIXME handle abort
		console.error(
			"lrGatherTabInfo: meta, capture, or microdata: continue despite the error %s %o", ex, ex);
	}
	try {
		const wrappedFrame = chain.find(f => f.frame && f.frame.frameId === (clickData && clickData.frameId));
		if (tab && tab.id >= 0) {
			if (!(wrappedFrame && wrappedFrame.summary && wrappedFrame.summary.scripts_forbidden)) {
				let script, target;
				if (clickData && clickData.captureObject === 'image') {
					script = "/content_scripts/lrc_image.js";
					target = 'image';
				} else if (clickData && clickData.captureObject === 'link') {
					script = "/content_scripts/lrc_link.js";
					target = "link";
				}
				if (target != null) {
					chain[0][target] = await executor.step(
						{ timeout: lr_tabframe.scriptTimeout },
						async function lrTargetObjectScript() {
							return await gLrAsyncScript.resultOrError(
								tab.id, clickData.frameId, { file: script });
						}
					);
				}
			}
		} else if (tab && clickData) {
			const frameInfo = {
				frame: {
					frameId: clickData.frameId,
					tabId: tab.id,
					url: tab.url,
					parentFrameId: -1,
					synthetic: "LinkRemark foreign frame",
				},
				tab: {
					id: tab.id,
					url: tab.url,
					title: tab.title,
					favIconUrl: tab.favIconUrl,
				},
				clickData,
			};
			chain.unshift(frameInfo);
		}
	} catch (ex) {
		console.error(
			"lrGatherTabInfo: click target: continue despite the error %s %0", ex, ex);
	}

	return chain;
}

function lrCaptureObjectMapTabGroupUrls(obj) {
	if (!obj.elements) {
		console.warn("lrCaptureObjectMapTabGroupUrls: no elements: %o", obj);
		return null;
	}
	const children = obj.elements.filter(e => !!e).map(lrCaptureObjectMapUrls).filter(e => !!e);
	switch (children.length) {
		case 0:
			return null;
		case 1:
			return children[0];
		default:
			return {
				_type: obj._type,
				children,
			};
	}
	return null;
}

function lrCaptureObjectMapTabFrameChain(obj) {
	const children = [];
	for (const frame of obj.elements) {
		children.push(...lr_meta.mapToUrls(frame));
	}
	if (!(children.length > 0)) {
		console.warn("lrCaptureObjectMapTabFrameChain: no elements found: %o", obj);
		return null;
	}
	if (children.length === 1) {
		const tab = children[0];
		if (tab._type === "Frame") {
			tab._type = "Tab";
		}
		return tab;
	}
	let title;
	for (const e of children) {
		if (e.title) {
			title = e.title;
		}
	}
	const tab = { _type: "Tab", children };
	if (title) {
		tab.title = title;
	}
	return tab;
}

function lrCaptureObjectMapUrls(projection) {
	if (!projection) {
		console.warn("lrCaptureObjectMapUrls: no object: %o", obj);
		return null;
	}
	switch (projection._type) {
		case "Text":
			return null;
		case "TabGroup":
			return lrCaptureObjectMapTabGroupUrls(projection);
		case "TabFrameChain":
			return lrCaptureObjectMapTabFrameChain(projection);
		default:
			console.warn("lrCaptureObjectMapUrls: unsupported type: %s %o",
				projection._type, projection);
	}
	return null;
}
