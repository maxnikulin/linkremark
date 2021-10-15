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

/**
 * Workaround to allow content scripts returning Promise in Chrome
 *
 * Such result transforms to empty object in `tabs.executeScript()`
 * result array.
 */
class LrAsyncScript {
	constructor() {
		this.resolve = this.doResolve.bind(this);
		this.reject = this.doReject.bind(this);
		this.map = new Map();
	};
	register(rpc) {
		rpc.register("asyncScript.resolve", this.resolve);
		rpc.register("asyncScript.reject", this.reject);
	};
	id(promiseId, tabId, frameId) {
		if (frameId !== undefined) {
			return `${promiseId}:${tabId}:${frameId}`;
		} else {
			return `${promiseId}:${tabId}`;
		}
	};
	async doResolve(params, port) {
		const [promiseId, result, warnings] = Array.isArray(params) ? params : [];
		if (promiseId == null) {
			throw new Error("request.params must be [promiseId, result, warnings]");
		}
		const tabId = port.tab.id;
		const frameId = port.frameId;
		let entry = this.getEntry(promiseId, tabId, frameId);
		if (entry) {
			if (result !== undefined) {
				entry.resolve(result);
			} else {
				entry.reject(new Error("No result received from the content script"));
			}
			this.delete(entry);
		} else if (result !== undefined) {
			entry = this.makeEntry(promiseId, tabId, frameId);
			entry.result = result;
		}
		// TODO report to some error collector
		for (let w of warnings || []) {
			console.warn(w);
		}
		if (result === undefined) {
			throw new Error("request.params must be [promiseId, result, warnings]");
		}
		return true;
	};
	async doReject(params, port) {
		const [promiseId, reason, warnings] = Array.isArray(params) ? params : [];
		if (promiseId == null) {
			throw new Error("request.params must be [promiseId, reason, warnings]");
		}
		const tabId = port.tab.id;
		const frameId = port.frameId;
		let entry = this.getEntry(promiseId, tabId, frameId);
		if (entry) {
			if (reason !== undefined) {
				// TODO wrap received failure reason into Error with background call stack
				entry.reject(reason);
			} else {
				entry.reject(new Error("No reason received from the content script"));
			}
			this.delete(entry);
		} else if (reason != null) { // null here, undefined in doResolve
			entry = this.makeEntry(promiseId, tabId, frameId);
			entry.error = reason;
		}
		// TODO CompoundError class to include list of warnings into thrown error.
		for (let w of warnings || []) {
			console.warn(w);
		}
		if (reason == null) {
			throw new Error("request.params must be [promiseId, reason, warnings]");
		}
		return true;
	};

	delete(entry) {
		for (const id of entry.ids) {
			this.map.delete(id);
		}
	};

	getEntry(promiseId, tabId, frameId) {
		const entry = this.map.get(this.id(promiseId, tabId, frameId));
		if (entry != null) {
			return entry;
		}
		return this.map.get(this.id(promiseId, tabId));
	};

	async resultOrError(tabId, frameId, details) {
		try {
			return { result: await this.exec(tabId, frameId, details) };
		} catch (ex) {
			console.error("LrAsyncScript error : ", details, ex);
			return { error: lr_util.errorToObject(ex) };
		}
	};

	async exec(tabId, frameId, details = {}) {
		console.assert(
			tabId != null && frameId != null,
			"LrAsyncScript.exec tabId and frameId arguments should be undefined", details
		);
		if (details.allFrames) {
			throw new Error("LrAsyncScript.exec: allFrames = true is not supported yet");
		}
		const responseArray = await bapi.tabs.executeScript(tabId, {
			...details,
			frameId,
			allFrames: false,
		});
		if (responseArray == null || !(responseArray.length > 0)) {
			throw new Error("LrAsyncScript.exec: no response received");
		}
		if (responseArray.length > 1) {
			throw new Error("LrAsyncScript.exec: ambiguous result");
		}
		const responseWithWarnings = responseArray[0];
		const {warnings, ...response} = responseWithWarnings || {};
		for (let w of warnings || []) {
			console.warn(w);
		}
		// FIXME undefined when trying to run on a privileged page in Firefox
		const keys = response != null ? Object.keys(response) : [];
		if (keys.length === 0) {
			throw new Error("LrAsyncScript.exec: privileged page or syntax error in " + details.file)
		} else if (keys.length !== 1) {
			throw new Error("LrAsyncScript.exec: compound response: " + JSON.stringify(response));
		}
		switch(keys[0]) {
			case "result":
				return response.result;
			case "error":
				throw response.error;
			case "promise":
				return this.execPromise(response.promise, tabId, frameId);
		}
		throw new Error("LrAsyncScript.exec: invalid response field: " + keys[0]);
	};

	execPromise(promiseId, tabId, frameId) {
		let entry = this.getEntry(promiseId, tabId, frameId);
		if (entry) {
			this.delete(entry);
			if (entry.result) {
				return entry.result;
			}
			throw entry.error;
		}
		entry = this.makeEntry(promiseId, tabId, frameId);
		// FIXME add timeout to bypass errors in the code
		// TODO save new Error() to entry and use it later to create
		// errors with better call stack.
		return new Promise((resolve, reject) => {
			entry.resolve = resolve;
			entry.reject = reject;
		});
	};

	makeEntry(promiseId, tabId, frameId) {
		const id = this.id(promiseId, tabId, frameId);
		const idNoFrame = this.id(promiseId, tabId);
		const entry = { ids: [id, idNoFrame] };
		this.map.set(id, entry);
		this.map.set(idNoFrame, entry);
		return entry;
	};
}
