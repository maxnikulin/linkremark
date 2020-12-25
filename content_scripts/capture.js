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
	 * Could introduce extra newlines and miss any spaces between `<li>` elements
	 */
	function getSelectionByRanges(selection) {
		const result = [];
		for (let i = 0; i < selection.rangeCount; ++i) {
			const range = selection.getRangeAt(i);
			// Selection property is "isCollapsed" but Range one is just "collapsed"
			if (!range.collapsed) {
				const text = range.toString().trim();
				if (text) {
					result.push(text);
				}
			}
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
			return getSelectionByRanges(selection);
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
