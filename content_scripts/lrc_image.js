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

lr_content_scripts.lrcImage = function lrcImage(elementId) {
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
		// Likely useless, returns `BODY`.
		// `document.querySelectorAll(":focus")` returns empty node list.
		// Such fallback works for focusable elements as links however.
		// console.debug(document.activeElement, document.querySelectorAll(":focus"));
		return document.activeElement;
	}

	function getUrl(node, attr) {
		const hrefAttr = node.getAttribute(attr);
		if (!hrefAttr || hrefAttr === "#" || hrefAttr.startsWith("javascript:")) {
			return { error: "LrNoURL" };
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

	function lrcImageProperties(elementId) {
		const result = [];
		function pushWarning(error, key) {
			result.push({
				property: 'warning',
				value: lrToObject(error),
				key: key || 'lr.image',
			});
		}

		const img = getTargetElement(
			elementId,
			error => pushWarning(error, 'lr.image.getTargetElement'));
		if (img == null || img.nodeName != 'IMG') {
			// Maybe it is worth checking CSS background-url property
			throw new Error(`target element is not an image: ${img && img.nodeName}`);
		}

		result.push({ ...getUrl(img, 'src'), property: 'srcUrl', key: 'image.src' });
		const attrArray = [
			{ attribute: 'alt', property: 'imageAlt', key: 'image.alt' },
			{ attribute: 'title', property: 'imageTitle', key: 'image.title' },
		];
		for (const attr of attrArray) {
			try {
				lrcAddDescriptor(img, result, attr);
			} catch (ex) {
				result.push({...attr, error: lrToObject(ex)});
			}
		}
		return result;
	}

	try {
		return { result: lrcImageProperties(elementId) };
	} catch (ex) {
		return { error: lrToObject(ex) };
	}
	return { error: "LR internal error: lrc_image.js: should not reach end of the function" };
};
