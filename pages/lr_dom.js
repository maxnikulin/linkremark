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

function E(tagName, attrs, ...children) {
	const e = document.createElement(tagName);
	for (const [attr, value] of Object.entries(attrs || {})) {
		if (attr === "className") {
			e.className = value || "";
		} else {
			e.setAttribute(attr, value != null ? value : "");
		}
	}
	for (const child of children) {
		e.append(child);
	}
	return e;
}
