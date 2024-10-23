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
		const id = result.id || lr_common.getId();
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

	lr_tabframe._hasWebNavigationPermission = async function _hasWebNavigationPermission() {
		if (chrome.webNavigation?.getAllFrames === undefined) {
			return false;
		}
		// Chromium-130 throws synchronously after `permissions.remove`
		//     chrome.webNavigation.getAllFrames({tabId: -1})
		//     Error: 'webNavigation.getAllFrames' is not available in this context.
		//
		// If the permission is not available
		//
		//     TypeError: Error in invocation of webNavigation.getAllFrames(object details, function callback): Error at parameter 'details': Error at property 'tabId': Value must be at least 0.
		try {
			return await bapi.permissions.contains({ permissions: [ "webNavigation" ] });
		} catch (ex) {
			Promise.reject(ex);
		}
		return false;
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
	if (!(tabId >= 0) || ! await lr_tabframe._hasWebNavigationPermission()) {
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

async function lrCheckFrameScriptsForbidden(tab, wrappedFrame, executor) {
	const tabId = tab?.id;
	const { frameId, url = "<Unknown URL>" } = wrappedFrame?.frame || {};
	let result = null;

	async function lrExecutePermissionForbiddenCheckScript(tab, frameId) {
		try {
			result = await lr_scripting.isForbidden({ tabId, frameId });
			if (result !== false) {
				console.debug(
					"lrCheckFrameScriptsForbidden: tab %o (%o) frame %o (%o): unable to run content scripts.",
					tabId, tab?.url, frameId, url);
			}
		} catch (ex) {
			console.warn(
				"lrCheckFrameScriptsForbidden: tab %o (%o) frame %o (%o): check failed: %o",
				tabId, tab?.url, frameId, url, ex);
		}
		return result;
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
 * Set `wrappedFrame` `property` to result or error of `func` execution
 */
async function lrExecuteFrameScript(tab, wrappedFrame, func, args, property, executor) {
	if (typeof property !== "string") {
		throw TypeError("Frame script propery is not a String");
	}
	const funcName = property;
	try {
		if (wrappedFrame.summary && wrappedFrame.summary.scripts_forbidden) {
			return;
		}
		if (!(tab && tab.id >= 0)) {
			console.debug("lrExecuteFrameScript: skipping due to unknown tab.id, likely privileged content %o", tab);
			throw new LrWarning("Unknown tab.id. Privileged page?");
		}
		wrappedFrame[property] = await executor.step(
			{
				timeout: lr_tabframe.scriptTimeout,
				funcName
			},
			lr_scripting.executeScript,
			{
				tabId: tab.id,
				frameId: wrappedFrame?.frame?.frameId,
			},
			func, args,
		);
	} catch (ex) {
		const error = lr_util.errorToObject(ex);
		wrappedFrame[property] = { error };
		if (!(await lrCheckFrameScriptsForbidden(tab, wrappedFrame, executor))) {
			executor.addError(ex);
			console.error('lrExecuteFrameScript', lrFormatFrameError(tab, wrappedFrame), funcName, error);
		}
	}
	try {
		const warnings = wrappedFrame[property]?.warnings;
		if (warnings) {
			const prefix = `lrExecuteFrameScript ${lrFormatFrameError(tab, wrappedFrame)} ${funcName}`;
			for (const w of warnings) {
				console.warn(prefix, w);
			}
		}
	} catch (ex) {
		console.debug('lrExecuteFrameScript: ignore error', ex);
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

async function lrCaptureTabGroup(captureTarget, executor) {
	const promises = executor.step(
		function launchTabGroupCaptures(tabTargetArray, executor) {
			return tabTargetArray.map(tabTarget => {
				const tab = tabTarget && (tabTarget.windowTab || tabTarget.frameTab);
				return executor.child(
					{ contextId: tab && tab.id },
					lrCaptureSingleTab, tabTarget
					/* implicit childExecutor argument */);
			});
		},
		captureTarget?.tabs);
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

	return { body: { _type: "TabGroup", elements, }, };
}

async function lrCaptureSingleTab({frameTab, windowTab, target}, executor) {
	// Firefox-95 may pass `undefined` as `TabData` on privileged pages
	// with reasonable `ClickData` however.
	if (!windowTab.url && !frameTab.url && !(target && target.pageUrl)) {
		throw new Error("Permission for a tab denied");
	}
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
	await lrExecRelationsScript(tab, chain, executor);
	return chain;
}

async function lrExecRelationsScript(tab, frames, executor) {
	if (!Array.isArray(frames)) {
		// To allow second pass if iterator is passed
		frames = Array.from(frames);
	}

	await executor.step(
		{ errorAction: lr_executor.ERROR_IS_WARNING },
		async function _lrExecRelationsScriptFrames(tab, frames, executor) {
			return await Promise.allSettled(Array.from(
				frames,
				wrappedFrame => lrExecuteFrameScript(
					tab, wrappedFrame, lr_content_scripts.lrcRelations,
					[ lr_meta.limits ], "relations", executor)
			));
		},
		tab, frames /*, implicit executor */);
	for (const wrappedFrame of frames) {
		executor.step(
			{ errorAction: lr_executor.ERROR_IS_WARNING },
			function _lrExecRelationsScriptProps(wrappedFrame) {
				const relations = wrappedFrame.relations && wrappedFrame.relations.result;
				if (!relations) {
					return;
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
			},
			wrappedFrame);
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
	// In Chromium `tab.url != frame.url` is possible, e.g.
	// `tab.url == "view-source:http://127.0.0.1:8000/"`
	// `frame.url == "http://127.0.0.1:8000/"`
	// `tab.title == "view-source:127.0.0.1:8000"`.
	// However `clickData.pageUrl` is the same as `frame.url`.
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
	const outerTab = frameMap.get(0).tab = {
		id: activeTab.id,
		url: activeTab.url,
		title: activeTab.title,
		favIconUrl: activeTab.favIconUrl
	};
	await executor.step(
		{ errorAction: lr_executor.ERROR_IS_WARNING },
		async function lrAddGroupName(tab, groupId) {
			if (!(groupId >= 0)) {
				return;
			}
			const title = (await bapi.tabGroups?.get(groupId))?.title;
			if (title) {
				tab.groupTitle = title;
			}
		},
		outerTab,
		activeTab?.groupId);
	const chain = frameId != null ? await lrFrameChainByClickData(tab, frameMap, clickData, executor) :
		await lrFrameChainGuessSelected(activeTab, frameMap, executor);
	// Hope that checking here instead of `lrExecutePermissionForbiddenCheckScript`
	// allows to avoid noise due to e.g. empty `<iframe>` somewhere on the page.
	executor.step(
		{ errorAction: lr_executor.ERROR_IS_WARNING },
		async function lrCheckFramePermissionsErrors(chain) {
			let count = 0;
			let checkForActiveElement = await lr_tabframe._hasWebNavigationPermission();
			for (const wrappedFrame of chain) {
				if (checkForActiveElement) {
					checkForActiveElement = false;
					const node = wrappedFrame?.summary?.activeElementNode?.toUpperCase?.();
					if (node && ["IFRAME", "FRAME", "OBJECT", "EMBED"].indexOf(node) >= 0) {
						// In the case of navigation `frame.src` does not match
						// frame URL in `webNavigation.getAllFrames` result.
						++count;
						continue;
					}
				}
				if (wrappedFrame.summary && wrappedFrame.summary.scripts_forbidden) {
					++count;
				}
			}
			if (count > 0) {
				throw new LrWarning(`Frames with restricted access: ${count}`);
			}
		},
		chain);

	await executor.step(
		{ errorAction: lr_executor.ERROR_IS_WARNING },
		async function _lrGetFrameMetadata(activeTab, chain, executor) {
			const scripts = [
				[ lr_content_scripts.lrcSelection, [ lr_meta.limits ], "selection" ],
				[ lr_content_scripts.lrcMeta, [ lr_meta.limits ], "meta" ],
				[ lr_content_scripts.lrcMicrodata, [ lr_meta.limits ], "microdata" ],
			];

			const metaPromises = [];
			for (const wrappedFrame of chain) {
				metaPromises.push(...scripts.map(script =>
					executor.step(lrExecuteFrameScript, activeTab, wrappedFrame, ...script)));
			}
			await Promise.allSettled(metaPromises);
		},
		activeTab, chain /*, implicit executor */);

	await executor.step(
		{ errorAction: lr_executor.ERROR_IS_WARNING },
		lrGetClickObject, tab, clickData, chain /*, implicit executor */);

	executor.step(
		{ errorAction: lr_executor.ERROR_IS_WARNING },
		function lrCheckScriptErrors(chain, executor) {
			for (const wrappedFrame of chain) {
				if (wrappedFrame?.summary?.scripts_forbidden) {
					continue;
				}
				for (const field of ["relations", "selection", "meta", "microdata", "image", "link"]) {
					const error = wrappedFrame[field]?.error;
					if (error != null) {
						executor.addError(new LrWarning(
							"Content script error: " + field,
							{ cause: lr_common.objectToError(error) }));
					}
				}
			}
		},
		chain /*, impicit executor */);
	return chain;
}

async function lrGetClickObject(tab, clickData, chain, executor) {
	const wrappedFrame = chain.find(f => f.frame && f.frame.frameId === (clickData && clickData.frameId));
	if (tab && tab.id >= 0) {
		if (clickData != null && !wrappedFrame?.summary?.scripts_forbidden) {
			const { captureObject, targetElementId } = clickData;
			let func, target, href;
			if (captureObject === 'image') {
				func = lr_content_scripts.lrcImage;
				target = 'image';
				href = clickData.srcUrl;
			} else if (captureObject === 'link') {
				func = lr_content_scripts.lrcLink;
				target = "link";
				href = clickData.linkUrl;
			}
			if (target != null) {
				const args = [ { targetElementId, href }, lr_meta.limits ];
				await executor.step(
					lrExecuteFrameScript, tab, wrappedFrame, func, args, target);
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
