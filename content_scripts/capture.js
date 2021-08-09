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

/* Script to collect data for capture:
 *
 * - title,
 * - selection if any.
 *
 * Injected using tabs.executeScript().
 * Produces array of property descriptors.
 */

"use strict";

(function lrContentSelection() {
	const config = {
		selection: "byRangesOrWhole",
	};

	/** Make Error instances fields available for backend scripts */
	function lrToObject(obj) {
		console.error(obj);
		if (obj instanceof Error) {
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
				const lines = value.trim().split("\n");
				error[prop] = lines.length > 1 ? lines : value;
			}
			return error;
		} else {
			return obj;
		}
	}

	function LrOverflowError(size) {
		self = this || {};
		self.name = "LrOverflowError";
		if (typeof size === "number") {
			self.size = size;
		} else {
			self.message = size;
		}
		return self;
	}

	const DEFAILT_SIZE_LIMIT = 1000;
	const TEXT_SIZE_LIMIT = 4000;
	const FRAGMENT_COUNT_LIMIT = 128;
	console.assert(TEXT_SIZE_LIMIT >= DEFAILT_SIZE_LIMIT, "text length limits should be consistent");

	function lrNormalize(value, sizeLimit) {
		sizeLimit = sizeLimit || DEFAILT_SIZE_LIMIT;
		const t = typeof value;
		let error;
		if (value == null || t === "boolean" || t === "number") {
			return [ value, error ];
		}
		if (t !== "string" && value.toString === Object.prototype.toString) {
			// [object Object] is obviously useless
			throw TypeError("Not a string and has no toString");
		}
		// Unlike `String(value)` rises `TypeError` for `Symbol`,
		// and it is more or less intentional.
		value = "" + value;
		if (!(value.length <= sizeLimit)) {
			error = new LrOverflowError(value.length);
			value = value.substring(0, sizeLimit);
		}
		return [ value, error ];
	}

	function lrPushProperty(array, getter, props) {
		props = props || {};
		const retval = { key: props.key || "unspecified." + (getter && getter.name) };
		try {
			if (!props.key) {
				throw new Error("Missed property key");
			}
			const [ value, error ] = lrNormalize(getter(), props.sizeLimit);
			if (value != null || props.forceNull) {
				retval.value = value;
			}
			if (error) {
				retval.error = error;
			}
		} catch (ex) {
			retval.error = lrToObject(ex);
		}
		if (retval.hasOwnProperty("value") || retval.error != null) {
			if (props.property) {
				retval.property = props.property;
			}
			array.push(retval);
		}
	}

	function lrNullOrString(arg) {
		return !arg ? null : String(arg);
	}

	function lrDocumentTitle() {
		return lrNullOrString(document.title);
	}
	function lrWindowLocation() {
		return lrNullOrString(window.location);
	}

	/**
	 * See ../doc/README.org#selection for explanation why the hack
	 * with alternating selection is necessary.
	 */
	function pushSelectionByRanges(selection, result) {
		const rangeArray = [];
		let available = TEXT_SIZE_LIMIT;
		for (let i = 0; i < selection.rangeCount; ++i) {
			rangeArray.push(selection.getRangeAt(i));
		}

		let error;

		let resultItem;
		function pushResultItem(item) {
			resultItem = {
				...item,
				key: "window.getSelection.range",
				property: "selection",
			};
			result.push(resultItem);
		}

		let fragmentArray;
		function pushResultNext(item) {
			fragmentArray.push(item);
		}
		let pushResult = function pushResultFirst(item) {
			fragmentArray = [ item ];
			pushResultItem({ value: fragmentArray });
			pushResult = pushResultNext;
		}

		try {
			let oldEnd = null;
			let oldEndOffset = null;
			let count = 0;
			for (const range of rangeArray) {
				// Selection property is "isCollapsed" but Range one is just "collapsed"
				if (range.collapsed) {
					continue;
				}
				selection.removeAllRanges();
				selection.addRange(range);
				const text = selection.toString().trim();
				if (!text) {
					continue;
				}
				++count;
				if (count > FRAGMENT_COUNT_LIMIT) {
					pushResult({ error: {
						name: "LrFragmentCountOverflow",
						size: rangeArray.length,
					} });
					break;
				}

				if (oldEnd != null) {
					const between = range.cloneRange();
					between.collapse(/* toStart = */ true);
					between.setStart(oldEnd, oldEndOffset);
					selection.removeAllRanges();
					selection.addRange(between);
					const separator = selection.toString();
					if (separator && separator.indexOf("\n") >= 0) {
						pushResult({ value: "" });
					}
				}

				if (text.length > available) {
					const error = new LrOverflowError(text.length);
					if (available >  DEFAILT_SIZE_LIMIT) {
						pushResult({ error, value: text.substring(text, available) });
					} else {
						pushResult(error);
					}
					break;
				} else {
					pushResult({ value: text });
				}
				available -= text.length;
				oldEnd = range.endContainer;
				oldEndOffset = range.endOffet;
			}
		} catch (ex) {
			error = ex;
		} finally {
			selection.removeAllRanges();
			for (const range of rangeArray) {
				selection.addRange(range);
			}
		}

		if (error) {
			error = lrToObject(error);
			if (resultItem != null) {
				resultItem.error = error;
			} else {
				pushResultItem({ error: lrToObject(error) });
				throw error;
			}
		}
		return fragmentArray != null;
	}
	/**
	 * Formatter will not be able to add " ... "
	 * between separate fragments selected with `[Ctrl]`,
	 * actually they are joined without any separator at all.
	 */
	function pushSelectionWhole(selection, result) {
		function lrGetSelection() {
			return selection && !selection.isCollapsed && selection.toString().trim();
		}
		lrPushProperty(result, lrGetSelection, {
			key: "window.getSelection.text",
			property: "selection",
			sizeLimit: TEXT_SIZE_LIMIT,
		});
	}

	function pushSelectionByRangesOrWhole(selection, result) {
		try {
			if (selection.rangeCount > 1 && pushSelectionByRanges(selection, result)) {
				return;
			}
		} catch (ex) {
			// error already reported
		}
		return pushSelectionWhole(selection, result);
	}

	/**
	 * MDN: Window.getSelection()
	 * https://developer.mozilla.org/en-US/docs/Web/API/Window/getSelection
	 *
	 * When called on an <iframe> that is not displayed
	 * (eg. where `display: none` is set) Firefox will return null,
	 * whereas other browsers will return a Selection object
	 * `with `Selection.type` set to None.
	 */
	function pushSelection(config, result) {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) {
			return null;
		}
		switch (config && config.selection) {
		case "whole":
			return pushSelectionWhole(selection, result);
		case "byRanges":
			return pushSelectionByRanges(selection, result);
		default:
			break;
		}
		return pushSelectionByRangesOrWhole(selection, result);
	}

	try {
		const properties = [
			{ getter: lrDocumentTitle, property: "title", key: "document.title" },
			{ getter: lrWindowLocation, property: "url", key: "window.location" },
		];
		const result = [];
		for (const { getter, ...descriptor } of properties) {
			try {
				lrPushProperty(result, getter, descriptor);
			} catch (ex) {
				descriptor.error = lrToObject(ex);
				result.push(descriptor);
			}
		}
		try {
			pushSelection(config, result);
		} catch (ex) {
			result.push({ property: "selection", key: "window.getSelection.text", error: lrToObject(ex) });
		}

		return { result };
	} catch (ex) {
		return { error: lrToObject(ex) };
	}
	return { error: "LR internal error: capture.js: should not reach end of the function" };
})();
