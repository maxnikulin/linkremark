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

var lr_test_abortable_ctx = lr_util.namespace(lr_test_abortable_ctx, function lr_test_abortable_ctx() {
	var lr_test_abortable_ctx = this;

	lr_test_abortable_ctx.test_addAbortedSignal = async function test_addAbortedSignal() {
		await lr_abortable_ctx.runAbortable(null, async function _addAbortedSignal(ctx) {
			const signal = AbortSignal.abort();
			let error;
			try {
				ctx.addAbortSignal(signal);
			} catch (ex) {
				error = ex;
			} finally {
				lr_test.assertEq(signal.reason, error, "Abort signal should be thrown");
			}
			try {
				await ctx.abortable(Promise.reject("Should not run"));
			} catch (ex) {
				error = ex;
			} finally {
				lr_test.assertEq(signal.reason, error, "Abort signal should be thrown");
			}
		});
	};

	lr_test_abortable_ctx.test_runAborted = async function test_runAborted() {
		const signal = AbortSignal.abort();
		lr_test.assertThrows(
			signal.reason,
			async function _test_runAborted() {
				await lr_abortable_ctx.runAbortable(signal, async () => true);
			});
	};

	lr_test.suites.push(this);
	return this;
});
