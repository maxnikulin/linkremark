/*
   Copyright (C) 2020-2023 Max Nikulin

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

var lr_content_scripts = lr_content_scripts || {};

lr_content_scripts.lrcLink = function lrcLink(target, limits) {
	/** Make Error instances fields available for backend scripts */
	function lrToObject(obj) {
		if (obj instanceof Error) {
			console.error(obj);
			var error = Object.create(null);
			if (obj.message != null) {
				error.message = obj.message;
			} else {
				error.message = "" + obj;
			}
			if (obj.name != null) {
				error.name = "" + obj.name;
			} else {
				error.name = Object.prototype.toString.call(obj);
			}
			for (let prop of ["code", "stack", "fileName", "lineNumber", "columnNumber"]) {
				const value = obj[prop];
				if (value == null) {
					continue;
				}
				if (typeof value !== "string") {
					error[prop] = value;
					continue;
				}
				// Make `stack` readable in `JSON.stringify()` dump.
				const lines = value.split("\n");
				error[prop] = lines.length > 1 ? lines : value;
			}
			return error;
		} else {
			return obj;
		}
	}

	function lrNormalize(value, sizeLimit) {
		sizeLimit = sizeLimit || limits.STRING;
		const t = typeof value;
		if (value == null || t === "boolean" || t === "number") {
			return { value };
		}
		if (t !== "string" && value.toString === Object.prototype.toString) {
			// [object Object] is obviously useless
			throw TypeError("Not a string and has no toString");
		}
		value = "" + value;
		if (!(value.length <= sizeLimit)) {
			const error = new LrOverflowError(value.length);
			value = value.substring(0, sizeLimit);
			return { value, error }
		}
		return { value };
	}

	async function lrSendMessage(method, params) {
		const msg = {method, params};
		const response = await browser.runtime.sendMessage(msg);
		if (response != null && response.result !== undefined) {
			return response.result;
		} else if (response != null && response.error) {
			throw response.error;
		}
		throw new Error ("Invalid response object");
	}

	function getTargetElement(elementId, errorCb) {
		try {
			const bapi = typeof browser !== "undefined" ? browser : chrome;
			const menus =  bapi?.menus ?? bapi?.contextMenus;
			if (elementId != null && menus?.getTargetElement !== undefined) {
				return menus.getTargetElement(elementId);
			}
		} catch (ex) {
			if (errorCb) {
				errorCb(ex);
			} else {
				console.error("LR: getTargetElement: %o", ex);
			}
		}
		return document.activeElement;
	}

	function guessTargetElementByHref(target, errorCb) {
		if (errorCb == null) {
			errorCb = console.error;
		}
		let link;
		const href = target?.href;
		if (href == null) {
			errorCb(new Error(`guessTargetElementByHref: href ${href}`));
			return link;
		}
		for (const a of document.querySelectorAll("a[href]")) {
			//      document.querySelectorAll(`a[href=CSS.escape(href)]`)
			// does not match relative URL
			//      <a href="relative.html">
			// since `onClickData.linkUrl` is absolute URL.
			if (href !== a.href && href !== a.getAttribute("href")) {
				continue;
			}
			if (link == null) {
				link = a;
				continue;
			}
			for (const attr of ["title", "download", "hreflang", "type"]) {
				const savedAttr = link.getAttribute(attr);
				const currentAttr = a.getAttribute(attr);
				if (savedAttr !== currentAttr) {
					// TODO use errorCb and add warnings to error in background
					throw new Error(`Ambiguous links having distinct ${attr}: ${savedAttr} != ${currentAttr}`);
					link = null;
					break;
				}
			}
			if (link.innerText !== a.innerText) {
				// TODO use errorCb and add warnings to error in background
				throw new Error("Ambiguous links having distinct text");
				link = null;
				break;
			}
		}
		return link;
	}

	function getUrl(node, attr) {
		const hrefAttr = node.getAttribute(attr);
		if (!hrefAttr || hrefAttr === "#") {
			return { error: "LrNoURL" };
		} else if (hrefAttr.startsWith("javascript:")) {
			return { value: "javascript:", error: "LrPlaceHolder" };
		} else if (hrefAttr.startsWith("data:")) {
			return { value: "data:", error: "LrPlaceHolder" };
		}
		return lrNormalize(node[attr]);
	}

	function lrcAddDescriptor(node, array, { attribute, property, key }) {
		const value = node.getAttribute(attribute);
		if (value != null) {
			array.push({...lrNormalize(value), property, key});
		}
	}

	function lrcGetText(node) {
		let result = null;
		try {
			// TODO more smart cut, avoid other links in siblings
			result = node.innerText;
			// TODO try to get text from title and alt elements inside (e.g. images)
			for (
				let parentNode = result.parent;
				result.length < 15 && parentNode !== document.html;
				parentNode = result.parentNode
			) {
				// TODO capture some text around <a> element, not whole parent text
				if (parentNode.innerText.length > 120) {
					break;
				}
				result = parentNode.innerText;
			}
		} catch (ex) {
			return { error: lrToObject(ex) };
		}
		// Allow long enough text if it is link innerText,
		// otherwise only short context from text around is allowed.
		return result && lrNormalize(result, limits.TEXT);
	}

	function lrcLinkProperties(target) {
		const result = [];
		function pushWarning(error, key) {
			result.push({
				property: 'warning',
				value: lrToObject(error),
				key: key || 'lr.link',
			});
		}

		let link = getTargetElement(
			target?.targetElementId,
			error => pushWarning(error, 'lr.link.getTargetElement'));
		// Original click target could be suitable if link text is too long
		for (; link != null && link.nodeName != 'A' && link != document.body; link = link.parentNode)
			;
		if (link == null || link.nodeName != 'A' || link.href !== target.href) {
			link = guessTargetElementByHref(target);
		}
		if (link == null || link.nodeName != 'A') {
			throw new Error(`target element is not a link: ${link && link.nodeName}`);
		}
		result.push({ ...getUrl(link, "href"), property: 'linkUrl', key: 'link.href' });
		const attrArray = [
			{ attribute: 'title', property: 'linkTitle', key: 'link.title' },
			{ attribute: 'download', property: 'linkDownload', key: 'link.download' },
			{ attribute: 'hreflang', property: 'linkHreflang', key: 'link.hreflang' },
			{ attribute: 'type', property: 'linkType', key: 'link.type' },
		];
		for (const attr of attrArray) {
			try {
				lrcAddDescriptor(link, result, attr);
			} catch (ex) {
				result.push({...attr, error: lrToObject(ex)});
			}
		}
		const textDescriptor = lrcGetText(link);
		if (textDescriptor) {
			result.push({ ...textDescriptor, property: 'linkText', key: 'link.text' });
		}
		return result;
	}

	try {
		return { result: lrcLinkProperties(target) };
	} catch (ex) {
		return { error: lrToObject(ex) };
	}
	return { error: "LR internal error: lrc_link.js: should not reach end of the function" };
	//# sourceURL=content_scripts/lrc_link_func.js
};
