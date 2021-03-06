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

var lr_tabframe = lr_util.namespace(lr_tabframe, function lr_tabframe() {
	const lr_tabframe = this;

	const FORMAT = "object";
	const VERSION = "0.2";
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
		const referrer = frameInfo.referrer;
		if (referrer && (referrer.hasFocus || activeOptions.has(referrer.activeElementNode))) {
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
	try {
		if (!(tabId >= 0)) {
			// May happen in Chromium-87 when context menu is invoked for a PDF file
			// but should be handled by caller since <embed> element
			// in Chrome created for PDF file has its own "tab".
			return [];
		}
		let frames = await bapi.webNavigation.getAllFrames({tabId});
		if (frames && frames.length > 0) {
			return frames;
		}
		console.warn(
			"lrGetAllFrames: tab {id: %s, url=%s}: empty frames: %o",
			tabId, tab.url, frames);
	} catch (ex) {
		console.error(
			"lrGetAllFrames: tab {id: %s, url=%s): exception %s\n%o",
			tabId, tab.url, ex, ex);
	}
	return [];
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
async function lrCheckFrameScriptsForbidden(tab, wrappedFrame) {
	const tabId = tab && tab.id;
	const frameId = wrappedFrame && wrappedFrame.frame && wrappedFrame.frame.frameId;
	async function lrExecutePermissionForbiddenCheckScript(tabId, frameId) {
		if (!(tabId >= 0)) {
			return true;
		}
		try {
			const retvalArray = await bapi.tabs.executeScript(tabId, {
				code: "314",
				frameId,
				allFrames: false,
			});
			return !(retvalArray && retvalArray[0] == 314);
		} catch (ex) {
			console.debug("lrCheckFrameScriptsForbidden: content scripts are not allowed: %o", ex);
			return true;
		}
		return null;
	}
	try {
		if (wrappedFrame.scripts_forbidden == null) {
			wrappedFrame.scripts_forbidden = await lrExecutePermissionForbiddenCheckScript(tabId, frameId);
		}
	} catch (ex) {
		console.error("lrCheckFrameScriptsForbidden: tab %o frame %o error %o",
			tab, frameId, ex);
	}
	return wrappedFrame.scripts_forbidden;
}

/**
 * Set `wrappedFrame` `property` to result or error of `file` execution
 */
async function lrExecuteFrameScript(tab, wrappedFrame, file, property) {
	try {
		if (wrappedFrame.scripts_forbidden) {
			return;
		}
		if (!(tab && tab.id >= 0)) {
			console.debug("lrExecuteFrameScript: skipping due to unknown tab.id, likely privileged content %o", tab);
			throw new Error("Unknown tab.id. Privileged page?");
		}
		const retvalArray = await bapi.tabs.executeScript(tab.id, {
			file: file,
			frameId: wrappedFrame.frame.frameId,
			allFrames: false,
		});
		if (!retvalArray || !(retvalArray.length > 0)) {
			throw new Error('tabs.executeScript got no result');
		}
		const retval = retvalArray[0];
		if (!retval) {
			throw new Error('tabs.executeScript is likely called for a privileged frame');
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
		if (!(await lrCheckFrameScriptsForbidden(tab, wrappedFrame))) {
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
	const promises = executor.child(function launchTabGroupCaptures(executor) {
		return tabTargetArray.map(tabTarget => executor.step(
			{ ignoreError: true },
			function launchTabCapture() {
				const tab = tabTarget && (tabTarget.windowTab || tabTarget.frameTab);
				return executor.child(
					{ tabId: tab && tab.id, tabUrl: tab && tab.url },
					lrCaptureSingleTab, tabTarget /* implicit childExecutor argument */
				);
			}));
	});
	const elements = await executor.child(async function waitTabGroupCaptures(executor) {
		let failures = promises.length;
		let errors = [];
		let result = [];
		for (const p of promises) {
			try {
				if (p) {
					const capture = await executor.step(
						{ result: true },
						async function waitSingleTabCapture(p) {
							return await p;
						}, p)
					result.push(capture.body);
					--failures;
				}
			} catch (ex) {
				errors.push(ex);
			}
		}
		if (promises.length === failures) {
			// TODO aggregate error
			throw new Error("Capture failed for all tabs");
		}
		if (failures !== 0) {
			result.unshift({ _type: "Text", elements: [ `Capture of ${failures} tabs failed` ] });
		}
		// TODO add errors to result as warnings
		return result;
	});

	return {
		title: "Tab Group", // i18n
		body: { _type: "TabGroup", elements },
	};
}

async function lrCaptureSingleTab({frameTab, windowTab, target}, executor) {
	try {
		if (!windowTab.url) {
			throw new Error("Permission denied");
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
			gLrResultCache.putTargetElement({tabId, frameId, targetElementId});
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
		return {
			body, url, title,
		};
	} catch (ex) {
		executor.notifier.tabFailure(windowTab && windowTab.id)
		throw ex;
	}
}

/**
 * If frameId is known (invoked from context menu handler)
 * then we could optimize a bit in comparison to `lrFrameChainGuessSelected()`
 * by avoiding queries to the most of frames if there are a lot of them on
 * the page.
 */
async function lrFrameChainByClickData(tab, frameMap, clickData) {
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
	await lrExecuteReferrerScript(tab, frameMap.values());
	return chain;
}

async function lrExecuteReferrerScript(tab, frames) {
	if (!Array.isArray(frames)) {
		// To allow second pass if iterator is passed
		frames = Array.from(frames);
	}

	try {
		await Promise.all(Array.from(
			frames,
			wrappedFrame => lrExecuteFrameScript(
				tab, wrappedFrame, "content_scripts/referrer.js", "referrer")
		));
	} catch (ex) {
		console.error("lrExecuteReferrerScript: continue despite the error %s %o", ex, ex);
	}
	for (const wrappedFrame of frames) {
		try {
			const referrer = wrappedFrame.referrer;
			const result = referrer && referrer.result;
			if (!result) {
				continue;
			}
			for (const property of result) {
				switch (property.key) {
					case "document.hasFocus":
						referrer.hasFocus = property.value;
						break;
					case "document.activeElement.nodeName":
						referrer.activeElementNode = property.value;
						break;
					default:
						break;
				}
			}
		} catch (ex) {
			console.error("lrExecuteReferrerScript: %o: continue despite the error %s %o", wrappedFrame, ex, ex);
		}
	}
}

async function lrFrameChainGuessSelected(tab, frameMap) {
	await lrExecuteReferrerScript(tab, frameMap.values());
	return lrFrameChainOrTopFrame(frameMap);
}

/**
 * clickData { frameId, captureObject[some fields of menus.OnClickData] }
 */
async function lrGatherTabInfo(tab, clickData, activeTab) {
	const frameId = clickData && tab && tab.id >= 0 ? clickData.frameId : null;
	// The only reason to call webNavigation.getFrame()
	// might be errorOccured property, but it is unused currently.
	// Fake top level frame will be added by lrMakeFrameMap.
	const frameArray = frameId === 0 ? [] : await lrGetAllFrames(activeTab);
	const frameMap = lrMakeFrameMap(activeTab, frameArray);
	console.assert(frameMap.has(0), "frameMap has at least synthetic frameId 0");
	frameMap.get(0).tab = {
		id: activeTab.id,
		url: activeTab.url,
		title: activeTab.title,
		favIconUrl: activeTab.favIconUrl
	};
	const chain = frameId != null ? await lrFrameChainByClickData(tab, frameMap, clickData) :
		await lrFrameChainGuessSelected(activeTab, frameMap);
	try {
		const metaPromises = chain.map(wrappedFrame =>
				lrExecuteFrameScript(activeTab, wrappedFrame, "content_scripts/capture.js", "content"));
		metaPromises.push(...chain.map(wrappedFrame =>
				lrExecuteFrameScript(activeTab, wrappedFrame, "content_scripts/meta.js", "meta")));
		metaPromises.push(...chain.map(wrappedFrame =>
				lrExecuteFrameScript(activeTab, wrappedFrame, "content_scripts/microdata.js", "microdata")));
		await Promise.all(metaPromises);
	} catch (ex) {
		console.error(
			"lrGatherTabInfo: meta, capture, or microdata: continue despite the error %s %o", ex, ex);
	}
	try {
		const wrappedFrame = chain.find(f => f.frame && f.frame.frameId === (clickData && clickData.frameId));
		if (tab && tab.id >= 0) {
			if (!(wrappedFrame && wrappedFrame.scripts_forbidden)) {
				let script, target;
				if (clickData && clickData.captureObject === 'image') {
					script = "content_scripts/image.js";
					target = 'image';
				} else if (clickData && clickData.captureObject === 'link') {
					script = "content_scripts/link.js";
					target = "link";
				}
				if (target != null) {
					chain[0][target] = await gLrAsyncScript.resultOrError(
						tab.id, clickData.frameId, { file: script });
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
