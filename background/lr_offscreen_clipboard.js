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

var lrOffscreenClipboardConfig = {
	method: "offscreen.clipboard",
	page: "/offscreen/lro_clipboard.html",
	taskTimeout: 1000,
	closeTimeout: 200,
	// `chrome.offscreen.Reason.CLIPBOARD`
	// is undefined when permission is not granted.
	reasons: [ 'CLIPBOARD' ],
	justification: "Copy to clipboard",
};

class LrOffscreenClipboard {
	_currentTask;
	constructor(config) {
		this.config = { ...config, __proto__: lrOffscreenClipboardConfig };
		lr_offscreen.registerPath(this.config.page);
	}
	async copy(data, signal) {
		if (this._currentTask) {
			throw new Error("Busy");
		}
		try {
			this._currentTask = lr_abortable_ctx.runAbortable(signal, ctx => this._doCopy(ctx, data));
			return await this._currentTask;
		} finally {
			this._currentTask = undefined;
		}
	}
	async _doCopy(ctx, data) {
		const { config } = this;
		const { taskTimeout } = config;
		let cancelTaskTimeout;
		if (taskTimeout > 0) {
			cancelTaskTimeout = ctx.addAbortSignal(AbortSignal.timeout(taskTimeout));
		}
		await ctx.abortable(this._assertPermissions());
		// Based on
		// https://github.com/GoogleChrome/chrome-extensions-samples/tree/1229875d30bfdc03841826b55514b930b2b814a5/functional-samples/cookbook.offscreen-clipboard-write
		// TODO: Unique URI parameter to detect concurrent calls
		// or failures to close document.
		const url = config.page;
		await ctx.abortable(lr_offscreen.createDocument(
			url, { reasons: config.reasons, justification: config.justification }));
		try {
			return await ctx.abortable(
				lr_common.sendMessage(config.method, [data]));
		} finally {
			try {
				cancelTaskTimeout?.();
			} catch (ex) {
				Promise.reject(ex);
			} finally {
				cancelTaskTimeout = undefined;
			}
			try {
				const { closeTimeout } = config;
				// Do not use `ctx` since it is necessary to try to `closeDocument()`
				// even in the case of abort.
				await lr_abortable_ctx.runAbortable(
					closeTimeout > 0 ? AbortSignal.timeout(closeTimeout) : undefined,
					closeCtx => closeCtx.abortable(lr_offscreen.closeDocument(url)));
			} catch (ex) {
				Promise.reject(ex);
			}
		}
	}
	async _assertPermissions() {
		const missed = [];
		for (const p of ["offscreen", "clipboardWrite"]) {
			if (!await bapi.permissions.contains({ permissions: [ p ] })) {
				missed.push(p);
			}
		}
		if (missed.length !== 0) {
			throw new Error(`Missed permissions: ${missed}`);
		}
		// Should never happen when the `offscreen` permission is granted.
		// After granting and revoking the permission Chrome-114 throws
		// `Error: 'offscreen.createDocument' is not available in this context.`
		if (chrome.offscreen === undefined) {
			throw new Error("The offscreen API unavailable, the permission is not granted");
		}
	}
}

lr_util.defineLazyGetter(self, "lr_offscreen_clipboard", () => new LrOffscreenClipboard());
