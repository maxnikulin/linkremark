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

/* Script to collect data for capture:
 *
 * - title,
 * - selection if any.
 *
 * Injected using tabs.executeScript().
 * Produces a key-value object.
 */
"use strict";

(function () {
	const config = {
		selection: "byRangesOrWhole",
	};

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

	const warnings = [];
	const response = { warnings };
	try {
		const DEFAILT_SIZE_LIMIT = 1000;
		const TEXT_SIZE_LIMIT = 4000;
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
				const [ value, error ] = lrNormalize(getter(), props.sizeLimit);
				if (value != null || props.forceNull) {
					retval.value = value;
				}
				if (error) {
					retval.error = error;
				}
				if (!props.key) {
					throw new Error("Missed property key");
				}
			} catch (ex) {
				retval.error = lrToObject(ex);
			}
			if (retval.hasOwnProperty("value") || retval.error != null) {
				array.push(retval);
			}
		}

		function lrDocumentTitle() {
			return "" + document.title;
		}
		function lrWindowLocation() {
			return "" + window.location;
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

			try {
				let oldEnd = null;
				let oldEndOffset = null;
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

					if (oldEnd != null) {
						const between = range.cloneRange();
						between.collapse(/* toStart = */ true);
						between.setStart(oldEnd, oldEndOffset);
						selection.removeAllRanges();
						selection.addRange(between);
						const separator = selection.toString();
						if (separator && separator.indexOf("\n") >= 0) {
							result.push({ key: "window.getSelection.range", value: ""});
						}
					}

					const item = {
						key: "window.getSelection.range",
					};
					if (text.length > available) {
						item.error = new LrOverflowError(text.length);
						if (available >  DEFAILT_SIZE_LIMIT) {
							item.value = text.substring(text, available);
						}
						result.push(item);
						break;
					} else {
						item.value = text;
					}
					result.push(item);
					available -= text.length;
					oldEnd = range.endContainer;
					oldEndOffset = range.endOffet;
				}
			} catch (ex) {
				warnings.push(lrToObject(ex));
			}
			selection.removeAllRanges();
			for (const range of rangeArray) {
				selection.addRange(range);
			}
			return result.length > 0 ? result : null;
		}
		/**
		 * Formatter will not be able to add " ... "
		 * between separate fragments selected with `[Ctrl]`,
		 * actually they are joined without any separator at all.
		 */
		function pushSelectionWhole(selection, result) {
			const item = {
				key: "window.getSelection.text",
			};
			const text = selection && !selection.isCollapsed && selection.toString().trim();
			if (text.length > TEXT_SIZE_LIMIT) {
				item.value = text.substring(0, TEXT_SIZE_LIMIT);
				item.error = new LrOverflowError(text.length);
			} else if (text) {
				item.value = text;
			} else {
				return;
			}
			result.push(item);
		}

		function pushSelectionByRangesOrWhole(selection, result) {
			try {
				if (selection.rangeCount > 1) {
					return pushSelectionByRanges(selection, result);
				}
			} catch (ex) {
				warnings.push(lrToObject(ex));
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

		const properties = [
			[ lrDocumentTitle, "document.title" ],
			[ lrWindowLocation, "window.location" ],
		];
		const result = [];
		for (const item of properties) {
			try {
				const [getter, key] = item;
				lrPushProperty(result, getter, { key: key });
			} catch (ex) {
				if (item && item.key) {
					result.push({ key: item.key, error: lrToObject(ex) });
				} else {
					console.error("LR: %o", item);
					warnings.push(lrToObject(ex));
				}
			}
		}
		try {
			pushSelection(config, result);
		} catch (ex) {
			result.push({ key: "window.getSelection.text", error: lrToObject(ex) });
		}

		response.result = result;
		return response;
	} catch (ex) {
		response.error = lrToObject(ex);
		return response;
	} finally {
		if (warnings.length === 0) {
			delete response.warnings;
		}
	}
	return { error: "LR internal error: capture.js: should not reach end of the function" };
})();
