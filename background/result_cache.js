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

var lr_rpc_store = lr_util.namespace(lr_rpc_store, function lr_rpc_store() {
	const NO_CAPTURE = "NO_CAPTURE";

	class LrRpcStore {
		constructor() {
			this.handleCapture = this.getCapture.bind(this);
			this.handleTargetElement = this.getTargetElement.bind(this);
			this.handleResult = this.getResult.bind(this);
			this.clear();
		}
		putResult(result) {
			this.result = result;
		};
		async getCapture() {
			if (this.result === NO_CAPTURE) {
				throw new Error("Nothing has captured yet");
			} else if (this.result == null || this.result.capture == null) {
				throw new Error("Capture was unsuccessful");
			}
			return this.result.capture;
		};
		getResult(_args, _port) {
			if (this.result == null) {
				throw new Error("Capture was unsuccessful");
			}
			return this.result;
		};
		clear() {
			this.result = NO_CAPTURE;
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

	Object.assign(this, { NO_CAPTURE, LrRpcStore });

	return this;
});
