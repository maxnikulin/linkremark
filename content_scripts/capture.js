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
		selection: "wholeOrByRanges",
	};

	function getMetadata() {
		return {
			title: window.document.title,
			url: window.location.toString(),
		};
	}

	/**
	 * See ../doc/README.org#selection for explanation why the hack
	 * with alternating selection is necessary.
	 */
	function getSelectionByRanges(selection) {
		const result = [];
		const rangeArray = [];
		for (let i = 0; i < selection.rangeCount; ++i) {
			rangeArray.push(selection.getRangeAt(i));
		}

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
					result.push("");
				}
			}

			result.push(text);
			oldEnd = range.endContainer;
			oldEndOffset = range.endOffet;
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
	function getSelectionWhole(selection) {
		const text = selection && !selection.isCollapsed && selection.toString().trim();
		return text ? [ text ] : null;
	}

	function getSelectionWholeOrByRanges(selection) {
		if (selection.rangeCount > 1) {
			try {
				return getSelectionByRanges(selection);
			} catch (ex) {
				console.error("LR: getSelectionByRanges %s %o", ex, ex);
			}
		}
		return getSelectionWhole(selection);
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
	function getSelection(config) {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) {
			return null;
		}
		switch (config && config.selection) {
		case "whole":
			return getSelectionWhole(selection);
		case "byRanges":
			return getSelectionByRanges(selection);
		default:
			break;
		}
		return getSelectionWholeOrByRanges(selection);
	}

	// TODO get user preferences
	// TODO obtain frameId somehow
	const result = getMetadata();
	const selection = getSelection(config);
	// Empty string is not interesting, 0 should not appear here.
	if (selection) {
		result.body = selection;
	}

	return result;
})();
