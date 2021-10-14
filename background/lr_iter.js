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

var lr_iter = lr_util.namespace(lr_iter, function lr_iter() {
	function *combine(...iterableArgs) {
		for (const iterable of iterableArgs) {
			if (iterable == null) {
				continue;
			} else if (typeof iterable === "string" || !iterable[Symbol.iterator]) {
				console.error('lr_iter.combine: not iterable "%o"', iterable);
				yield iterable;
				continue;
			}
			yield *iterable;
		}
	}

	function first(iterable) {
		for (const item of iterable) {
			if (item != null) {
				return item;
			}
		}
	}

	function LrEnumerated(entry, index) {
		this.entry = entry;
		this.index = index;
	}

	function* stableSort(iterable, comparator) {
		const enumerated = Array.from(iterable)
			.map((entry, index) => new LrEnumerated(entry, index));
		enumerated.sort(function stableSortCmp(a, b) {
			const cmpResult = comparator(a.entry, b.entry);
			if (cmpResult) {
				return cmpResult;
			}
			return a.index - b.index;
		});
		for (const it of enumerated) {
			yield it.entry;
		}
	}

	function* map(iterable, mapping) {
		if (!iterable) {
			return;
		}
		for (const value of iterable) {
			yield mapping(value);
		}
	}

	Object.assign(this, {
		combine,
		first,
		map,
		stableSort,
	});
});
