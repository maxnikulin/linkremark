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

var lr_formatter = lr_util.namespace(lr_formatter, function lr_formatter() {
	var lr_formatter = this;
	function parseDate(date) {
		if (date == null) {
			return [];
		}
		if (typeof date === 'number') {
			return [new Date(date), ' ', "" + date ];
		} else if (typeof date !== 'string') {
			return [ "" + date ];
		}
		if (
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(date)
			|| /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(date)
		) {
			const obj = new Date(date);
			if (!Object.is(obj.valueOf(), Number.NaN)) {
				return [ obj, ' ', date ];
			}
		}
		return [ date ];
	};

	function ensureSingleLine(text) {
		if (typeof text !== 'string') {
			return text;
		}
		return text.replace(/\s+/g, function normSpace(str) {
			const first = str[0];
			if (first === '\u200B' || first === '\u00a0' /* &nbsp */) {
				return first;
			}
			return ' ';
		});
	}

	Object.assign(this, {
		ensureSingleLine,
		parseDate,
	});

	return this;
});
