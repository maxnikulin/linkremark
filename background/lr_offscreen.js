/*
   Copyright (C) 2023 Max Nikulin

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

/** An observer to intended to detect programming errors.
 *
 * Or discrepancy of expected and actual behavior.
 * It does not implement a queue or block concurrent attempts
 * to create another offscreen document.
 */
class LrOffscreen {
	checkTimeout = 127;
	_current;
	_pathSet = new Set();
	_inProgress;
	registerPath(path) {
		// TODO ensure absolute paths
		this._pathSet.add(path);
	}
	/** @arg: createOptions: {justification, reasons}
	 */
	async createDocument(path, createOptions) {
		const url = chrome.runtime.getURL(path);
		const progress = await this._setInProgress(
			`createDocument(${path})`, this._checkCreateDocument(path));
		try {
			const retval = await chrome.offscreen.createDocument({...createOptions, url});
			this._current = url;
			return retval;
		} finally {
			this._resetInProgress(progress);
		}
	}
	async closeDocument(path) {
		const progress = await this._setInProgress(
			`closeDocument(${path})`, this._checkCloseDocument(path));
		try {
			const retval = await chrome.offscreen.closeDocument();
			this._current = false;
		} finally {
			this._resetInProgress(progress);
		}
	}
	async _getDocuments(url) {
		const prefix = chrome.runtime.getURL("/");
		const result = [];
		const checkURL = typeof url === "string";
		for (const c of await clients.matchAll()) {
			if (!c.url.startsWith(prefix)) {
				continue;
			}
			if (checkURL && c.url === url) {
				result.push(c.url);
				continue;
			}
			const urlObject = new URL(c.url);
			if (this._pathSet.has(urlObject.pathname)) {
				result.push(c.url);
			}
		}
		return result;
	}
	async _checkCreateDocument(path) {
		const url = chrome.runtime.getURL(path);
		const urlObject = new URL(url);
		if (!this._pathSet.has(urlObject.pathname)) {
			console.warn(`LrOffscreen.createDocument(${path}): not registered`);
		}
		const { _current } = this;
		const existing = await this._getDocuments(url);
		if (existing.length === 0) {
			if (_current === false) {
				return true;
			}
			this._current = false;
			// `undefined` means first call.
			if (_current !== undefined) {
				console.warn(`LrOffscreen.createDocument: disappeared ${_current}`);
			}
			return true;
		} else if (existing.length === 1) {
			if (current !== existing[0]) {
				this._current = existing[0];
			}
			if (url === existing[0] && url === _current) {
				console.warn(`LrOffscreen.createDocument(${path}): exists`);
			} else {
				this._current = existing[0];
				console.warn(
					`LrOffscreen.createDocument(${path}): expected ${_current} exists ${existing}`);
			}
		} else {
			this._current = true;
			console.warn(`LrOffscreen.createDocument(${path}: multiple exist ${existing}`);
		}
		return false;
	}
	async _checkCloseDocument(path) {
		const url = chrome.runtime.getURL(path);
		const urlObject = new URL(url);
		if (!this._pathSet.has(urlObject.pathname)) {
			console.warn(`LrOffscreen.closeDocument(${path}): not registered`);
		}
		const { _current } = this;
		if (this._current !== url) {
			console.warn(`LrOffscreen.closeDocument(${path}): inconsistent ${_current}`);
		}
		const existing = await this._getDocuments(url);
		if (existing.length === 1 && url === existing[0]) {
			return true;
		}
		if (existing.length === 0) {
			this._current = false;
			console.warn(`LrOffscreen.closeDocument(${path}): disappeared ${_current}`);
		} else {
			if (existing.length === 1) {
				this._current = url;
			} else {
				this._current = true;
			}
			console.warn(`LrOffscreen.closeDocument(${path}: unexpected ${existing}`);
		}
		return false;
	}
	async _setInProgress(task, checkPromise) {
		// console.debug(`LrOffscreen: in progress: ${task}`);
		try {
			const current = this._inProgress;
			this._inProgress = { time: new Date(), task };
			if (current !== undefined) {
				console.warn(
					"LrOffscreen: another call in progress",
					JSON.stringify(current), JSON.stringify(this._inProgress));
			}
		} catch (ex) {
			console.warn("LrOffscreen._setInProgress: ignored", ex);
		}
		try {
			if (this.checkTimeout > 0) {
				await lr_abortable_ctx.runAbortable(
					AbortSignal.timeout(this.checkTimeout), () => checkPromise);
			} else
				await checkPromise;
		} catch (ex) {
			console.warn("LrOffscreen._setInProgress: ignored: check:", ex);
		}
		return this._inProgress;
	}
	_resetInProgress(descr) {
		try {
			if (this._inProgress !== descr) {
				console.warn(
					"LrOffscreen: call in progress changed",
					JSON.stringify(descr), JSON.stringify(this._inProgress));
				return;
			}
			this._inProgress = undefined;
		} catch (ex) {
			console.warn("LrOffscreen._resetInProgress: ignored", ex);
		}
	}
}

lr_util.defineLazyGetter(self, "lr_offscreen", () => new LrOffscreen());
