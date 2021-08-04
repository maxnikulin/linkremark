/*
   Copyright (C) 2021 Max Nikulin

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

var lr_multimap = lr_util.namespace(lr_multimap, function lr_multimap() {
	var lr_multimap = this;
	class LrMultiMap extends Map {
		constructor(items) {
			super();
			if (!items) {
				return;
			}
			for (const [ key, value ] of items) {
				this.add(key, value);
			}
		}
		set(key, value) {
			let set = super.get(key);
			if (!set) {
				set = new Set();
				super.set(key, set);
			}
			set.add(value);
			return this;
		}
		has(key, value = undefined) {
			const set = super.get(key);
			if (set === undefined) {
				return false;
			} else if (value === undefined) {
				return true;
			}
			return set.has(value);
		}
		delete(key, value = undefined) {
			if (value === undefined) {
				return super.delete(key);
			}
			const set = super.get(key);
			const retval = set !== undefined && set.delete(value);
			if (retval && set.size === 0) {
				super.delete(key);
			}
			return retval;
		}

		*values(key = undefined) {
			if (key !== undefined) {
				const set = super.get(key);
				if (set !== undefined) {
					yield *set;
				}
				return;
			}
			for (const set of super.values()) {
				yield* set;
			}
		}
	}

	Object.assign(this, { LrMultiMap });
	return this;
});
