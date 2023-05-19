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

lr_content_scripts.lrcLink = function lrcLink(elementId) {
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

	const DEFAILT_SIZE_LIMIT = 1000;
	const TEXT_SIZE_LIMIT = 4000;
	console.assert(TEXT_SIZE_LIMIT >= DEFAILT_SIZE_LIMIT, "text length limits should be consistent");

	function lrNormalize(value, sizeLimit) {
		sizeLimit = sizeLimit || DEFAILT_SIZE_LIMIT;
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
		return result && lrNormalize(result, TEXT_SIZE_LIMIT);
	}

	function lrcLinkProperties(elementId) {
		const result = [];
		function pushWarning(error, key) {
			result.push({
				property: 'warning',
				value: lrToObject(error),
				key: key || 'lr.link',
			});
		}

		let link = getTargetElement(elementId, error => pushWarning(error, 'lr.link.getTargetElement'));
		// Original click target could be suitable if link text is too long
		for (; link != null && link.nodeName != 'A' && link != document.body; link = link.parentNode)
			;
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
		return { result: lrcLinkProperties(elementId) };
	} catch (ex) {
		return { error: lrToObject(ex) };
	}
	return { error: "LR internal error: lrc_link.js: should not reach end of the function" };
};
