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

"use strict";

class LrResultCache {
	constructor() {
		this.handleLast = this.getLast.bind(this);
		this.handleTargetElement = this.getTargetElement.bind(this);
		this.handleLastResult = this.getLastResult.bind(this);
	}
	put(result, debugInfo = null) {
		this.lastResult = result;
		this.lastDebugInfo = debugInfo;
	};
	async getLastResult() {
		if (this.lastResult == null) {
			throw new Error("No capture result have been stored");
		}
		return this.lastResult;
	};
	getLastDebugInfo() {
		return this.lastDebugInfo;
	};
	getLast(_args, _port) {
		return { result: this.lastResult, debugInfo: this.lastDebugInfo };
	};
	clear() {
		this.lastResult = this.lastDebugInfo = null;
	};
	putTargetElement(object) {
		this.targetElement = object;
	};
	getTargetElement() {
		// FIXME check that tab & frame are the same
		return this.targetElement != null ? this.targetElement.targetElementId : null;
	};
}

var gLrResultCache = new LrResultCache();
