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

class LrRpcStore {
	static NO_CAPTURE = "NO_CAPTURE";
	constructor() {
		this.handleCapture = this.getCapture.bind(this);
		this.handleTargetElement = this.getTargetElement.bind(this);
		this.handleResult = this.getResult.bind(this);
		this.clear();
	}
	putExecInfo(execInfo) {
		this.execInfo = execInfo;
	};
	getCapture() {
		if (this.execInfo === LrRpcStore.NO_CAPTURE) {
			throw new Error("Nothing has captured yet");
		}
		const result = this.execInfo && this.execInfo && this.execInfo.result;
		const capture = result && result.capture;
		if (capture == null) {
			throw new Error("Capture was unsuccessful");
		}
		return capture;
	};
	getResult(_args, _port) {
		if (this.execInfo == null) {
			throw new Error("Capture was unsuccessful");
		}
		return this.execInfo;
	};
	clear() {
		this.execInfo = LrRpcStore.NO_CAPTURE;
		this.targetElement = null;
	};
	putTargetElement(object) {
		this.targetElement = object;
	};
	getTargetElement(_, port) {
		if (this.targetElement == null || this.targetElement.targetElementId == null) {
			console.warn("LrRpcStore: targetElement requested despite no Id is stored");
		};

		if (this.targetElement == null) {
			return null;
		}
		const { tabId, frameId } = this.targetElement;
		if (port.tab.id !== tabId || port.frameId !== frameId) {
			console.error("LrRpcStore: stored for %o requested from %o",
				{ tabId, frameId }, { tabId: port.tab.id, frameId: port.frameId });
			throw new Error("Target element requested from wrong frame");
		}
		return this.targetElement.targetElementId;
	};
}
