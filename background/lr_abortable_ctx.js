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

var lr_abortable_ctx = lr_util.namespace(lr_abortable_ctx, function lr_abortable_ctx() {
	var lr_abortable_ctx = this;

	class _PromiseDeferred {
		constructor() {
			this._promise = new Promise(
				(resolve, reject) => { this._resolve = resolve; this._reject = reject; });
		}
		releasePromise() {
			const retval = this._promise;
			this._promise = undefined;
			return retval;
		}
		resolve(result) {
			if (this.settled) {
				return;
			}
			this._resolve(result);
			this.destroy(true);
		}
		reject(error) {
			if (this.settled) {
				return;
			}
			this._reject(error);
			this.destroy(true);
		}
		get settled() {
			return this._reject === undefined;
		}
		destroy(fromSettle) {
			if (this._promise !== undefined) {
				this._promise = undefined;
				console.warn("lr_abortable_ctx._PromiseDeferred: releasePromise has not called");
			}
			if (!fromSettle && !this.settled) {
				this.reject(new Error("PromiseDeferred destroyed before settled"));
			}
			this._resolve = this._reject = undefined;
		}
	}

	class _AbortableContextRunner {
		aborted = false;
		reason;
		_deferred = new Set();
		_destructors = new Set();
		constructor(signal) {
			if (signal != undefined) {
				this.addAbortSignal(signal);
			}
		}
		/** Returns a function to remove event listener
		 */
		addAbortSignal(signal) {
			if (signal.aborted) {
				const { reason } = signal;
				this._onAbort(reason);
				throw reason;
			}
			return this.addEventTarget(signal, "abort", this.getAbortReason);
		}
		addEventTarget(target, eventName, getReason, params) {
			const listener = this._abortListener.bind(this, getReason ?? this.getAbortReason);
			target.addEventListener(eventName, listener, { once: true, ...params });
			const removeParams = { listener, params };
			const remover = this._removeListener.bind(this, target, eventName, removeParams);
			removeParams.remover = remover;
			this._destructors.add(remover);
			return remover;
		}
		/** Promise wrapper method to reject on abort event.
		 * Argument is evaluated only if the context has not aborted yet,
		 * otherwise the getter throws instead of returning a function to call.
		 */
		get abortable() {
			if (this.aborted) {
				throw this.reason;
			}
			return this._abortable;
		}
		_abortable(thenable) {
			const deferred = new _PromiseDeferred();
			this._deferred.add(deferred);
			thenable.then(
				function _resolveAbortable(deferred, r) {
					if (this.aborted) {
						if (!deferred.settled) {
							// Should be already done
							deferred.reject(this.reason);
							this._warn(new Error("Abortable deferred is not destroyed"));
						} else {
							console.debug("Result discarded due to abort");
							return;
						}
					} else {
						deferred.resolve(r);
					}
					this._deferred.delete(deferred);
				}.bind(this, deferred),
				function _rejectAbortable(deferred, e) {
					if (this.aborted) {
						if (!deferred.settled) {
							// Should be already done
							deferred.reject(e);
							this._warn(new Error("Abortable deferred is not destroyed"));
						} else {
							console.debug("Error discarded due to abort", e);
							return;
						}
					} else {
						deferred.reject(e);
					}
					this._deferred.delete(deferred);
				}.bind(this, deferred));
			return deferred.releasePromise();
		}
		/* To be called after each await if expensive computations
		 * or when getting/setting global state followed.
		 */
		throwIfAborted() {
			if (this.aborted) {
				throw this.reason;
			}
		}
		_abortListener(getReason, ev) {
			let reason;
			try {
				reason = getReason?.(ev);
			} catch (ex) {
				reason = ex;
			}
			this._onAbort(reason);
		}
		_onAbort(reason) {
			if (!this.aborted) {
				this.aborted = true;
				this.reason = reason;
			} else {
				console.assert(this._deferred?.size === 0, "All deferred should be rejected");
				console.assert(this.reason !== undefined, "Abort reason should be set");
				this.reason = this.reason ?? reason;
			}
			if (reason == null) {
				reason = new Error("Aborted for unspecified reason");
			}
			const deferredArray = [...this._deferred].reverse();
			this._deferred.clear();
			for (const deferred of deferredArray) {
				try {
					deferred.reject(reason);
				} catch (ex) {
					this._warn(ex);
				}
			}
		}
		_removeListener(target, eventName, params) {
			const { listener, remover } = params;
			if (this._destructors.delete(remover)) {
				target.removeEventListener(eventName, listener, params.params);
			}
		}
		getAbortReason(ev) {
			return ev?.target?.reason;
		}
		_destroy() {
			try {
				if (!this.aborted) {
					this._onAbort(new Error("Abortable context destroyed"));
				}
			} catch (ex) {
				this._warn(ex);
			}
			const destructors = [ ...this._destructors ];
			this._destructors.clear();
			for (let i = destructors.length; i-- > 0; /* pass */) {
				try {
					destructors[i]();
				} catch (ex) {
					this._warn(ex);
				}
			}
		}
		_warn = Promise.reject.bind(Promise); // TODO logger
	}

	lr_abortable_ctx.runAbortable = async function runAbortable(signal, func) {
		const ctx = new _AbortableContextRunner(signal);
		try {
			return await func(ctx);
		} finally {
			ctx._destroy();
		}
	};

	Object.assign(lr_abortable_ctx, { _PromiseDeferred, _AbortableContextRunner });

	return this;
});
