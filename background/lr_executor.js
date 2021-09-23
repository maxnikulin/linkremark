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

var lr_executor = lr_util.namespace(lr_executor, function lr_format_org() {
	var lr_executor = this;

	for (const name of ["IGNORE_ERROR", "ERROR_IS_WARNING"]) {
		Object.defineProperty(lr_executor, name, {
			get() { return name; },
		});
	}

	class LrNullNotifier {
		async start() {}
		async startContext() {}
		makeNested() {
			return this;
		}
		addContextObject(_object) {}
		async error(err) {
			console.error("lr_executor.LrNullNotifier.error: %o", err);
		}
		async completed() {}
	}

	class LrBrowserActionNotifier {
		constructor() {
			this.tabs = new Map();
			this.contextObjects = new WeakMap();
		}
		async start(params) {
			return await this.startContext(null, params);
		}
		/// TODO: Should be called through LrExecutor, not directly.
		async startContext(tab, params) {
			try {
				let tabId, url;
				if (tab == null) {
					tabId = null;
				} else {
					({ id: tabId, url } = tab);
					if (!(tabId >= 0)) {
						throw new Error("Invalid tab.id");
					}
					if (!url) {
						console.log("LrBrowserActionNotifier.startContext: missed tab.url, maybe no tabs permissions: %o", tab);
					}
				}
				const context = this.tabs.get(tabId);
				if (context != null) {
					const { state } = context;
					if (state === lr_notify.state.WARNING || state === lr_notify.state.ERROR) {
						console.error("LrBrowserActionNotifier.startContext: tab %o already failed", tabId);
					} else {
						console.warn("LrBrowserActionNotifier.startContext: tab %o state %o has been set earlier", tabId, state);
					}
					return;
				}
				const state = lr_notify.state.PROGRESS;
				this.tabs.set(tabId, { state, url });

				if (params && params.default) {
					if (tab == null) {
						throw new Error("No tab specified for default context");
					}
					if (this.defaultContext != null) {
						throw new Error("Default context already set");
					}
					this.defaultContext = tabId;
				}

				return lr_notify.notify({ tabId, state });
			} catch (ex) {
				console.error("LrBrowserActionNotifier.startContext: ignored error: %o %o %o", ex, tab, params);
			}
		}

		makeNested({ id: contextId, object: contextObject }) {
			if (contextId !== undefined && contextObject !== undefined) {
				console.warn("LrBrowserActionNotifier.makeNested: both contextId and contextObject are specified");
			}
			if (contextId != null) {
				if (!this.tabs.has(contextId)) {
					console.warn("LrBrowserActionNotifier.makeNested: unknown contextId: %o", contextId);
				} else {
					return Object.assign(Object.create(this), { defaultContext: contextId, nested: true });
				}
			}
			if (contextObject != null) {
				const mappedContext = this.contextObjects.get(contextObject);
				if (mappedContext == null) {
					console.warn("LrBrowserActionNotifier.makeNested: unknown contextObject: %o", contextObject);
				} else {
					return Object.assign(Object.create(this), { defaultContext: mappedContext, nested: true });
				}
			}
			if (contextId !== undefined || contextObject !== undefined) {
				console.warn("LrBrowserActionNotifier.makeNested: unknown arguments: %o %o", contextId, contextObject);
			}
			return this;
		}

		addContextObject(object) {
			if (this.defaultContext == null) {
				return;
			}
			this.contextObjects.set(object, this.defaultContext);
		}

		async error(error) {
			try {
				if (error == null) {
					return;
				}
				const parent = this.nested && this.defaultContext != null &&
					Object.getPrototypeOf(this);
				if (parent && this.defaultContext === parent.defaultContext) {
					return;
				}
				const isWarning = lr_common.isWarning(error);
				const newState = lr_notify.state[isWarning ? "WARNING" : "ERROR"];
				const tabs = this.nested && this.defaultContext != null ?
					[[ this.defaultContext, this.tabs.get(this.defaultContext)]] : this.tabs;
				const promises = []
				for (const [id, t] of tabs) {
					const { state: currentState, url } = t;
					if (!this._checkUrl(id, url)) {
						continue;
					}
					const state = (
						currentState === lr_notify.state.PROGRESS ||
						newState === lr_notify.state.ERROR
					) ? newState : currentState;
					promises.push(lr_notify.notify({ state, tabId: id }));
					if (this.defaultContext != null) {
						this.tabs.set(id, { ...t, state });
					}
				}
				await Promise.all(promises);
			} catch (ex) {
				// TODO report to executor?
				console.error("LrBrowserActionNotifier: ignore error: %o", ex);
			}
		}
		async completed(_result) {
			try {
				const success = Array.from(this.tabs.values())
					.every(x => (x && x.state) === lr_notify.state.PROGRESS);
				const state = success ? lr_notify.state.SUCCESS : lr_notify.state.WARNING;
				const promises = [];
				for (const [tabId, { state: tabState, url }] of this.tabs) {
					if (tabState === lr_notify.state.PROGRESS && this._checkUrl(tabId, url)) {
						// Error should be apparent from any tab,
						// success should be only shown for captured tabs.
						promises.push(lr_notify.notify({
							tabId,
							state: tabId != null || !success ? state : lr_notify.state.NOTHING,
						}));
					}
				}
				try {
					await Promise.all(promises);
				} catch (ex) {
					console.error("LrBrowserActionNotifier.completed: ignore notifier error: %o", ex);
				}
			} catch (ex) {
				this.error(ex);
				throw ex;
			}
		}

		async _checkUrl(tabId, url) {
			try {
				if (!(tabId >= 0) || !url) {
					return true;  // global notification or no tabs permission
				}
				const tab = await bapi.tabs.get(tabId);
				return tab.url === url;
			} catch (ex) {
				console.error(
					"LrBrowserActionNotifier._checkUrl(%o, %o): ignored error: %o",
					tabId, url, ex);
			}
			return true;
		}
	}

	function _normArgs(func, ...args) {
		let descr;
		if (!lr_util.isFunction(func) && !lr_util.isAsyncFunction(func)) {
			descr = func;
			func = args.shift();
		}
		descr = descr || {};
		descr.step = descr.step || (func && func.name);
		return [descr, func, args];
	};

	class LrExecutor {
		constructor(params) {
			const { notifier, parent } = params || {}
			this.notifier = notifier || new LrNullNotifier();
			this.parent = parent;
			this.debugInfo = [];
		}

		get result() {
			let top = this;
			for ( ; top.parent != null ; top = top.parent) {
				;
			}
			if (!top._result) {
				top._result = { debugInfo: top.debugInfo };
			}
			return top._result;
		}

		step(maybeDescr, ...funcAndArgs) {
			const [descr, func, args] = lr_executor._normArgs(maybeDescr, ...funcAndArgs);
			if (lr_util.isAsyncFunction(func)) {
				return this._asyncStep(descr, func, ...args);
			}
			this.debugInfo.push(descr);
			const saveResult = descr.result;
			if (saveResult) {
				descr.result = null;
			}
			try {
				if (!lr_util.isFunction(func)) {
					throw new TypeError("LrExecutor.step: not a function");
				}
				args.push(this);
				const result = func(...args);
				if (saveResult) {
					descr.result = result;
				}
				return result;
			} catch (ex) {
				this._onException(descr, ex);
			}
		}

		async _asyncStep(descr, func, ...args) {
			this.debugInfo.push(descr);
			const saveResult = descr.result;
			if (saveResult) {
				descr.result = null;
			}
			try {
				args.push(this);
				const result = await func(...args);
				if (saveResult) {
					descr.result = result;
				}
				return result;
			} catch (ex) {
				this._onException(descr, ex);
			}
		}

		child(maybeDescr, ...funcAndArgs) {
			let [fullDescr, func, args] = lr_executor._normArgs(maybeDescr, ...funcAndArgs);
			const { contextId, contextObject, ...descr } = fullDescr;
			const notifier = this.notifier.makeNested({ id: contextId, object: contextObject });
			const child = new LrExecutor({ parent: this, notifier, });
			args.push(child);
			let finalize = 1;
			const child_copyError = (result, ex) => {
				--finalize;
				if (!(finalize > 0)) {
					child.finalized = true;
					const error = child.ownError();
					this.addError(error);
					if (this.notifier.defaultContext !== notifier.defaultContext) {
						notifier.error(ex || error);
					}
				}
				return result;
			};
			try {
				if (lr_util.isAsyncFunction(func)) {
					++finalize;
					return this._asyncStep({ children: child.debugInfo, ...descr }, func, ...args)
						.then(child_copyError, ex => {
							child_copyError(undefined, ex);
							throw ex;
						});
				}
				return child_copyError(this.step({ children: child.debugInfo, ...descr }, func, ...args));
			} catch (ex) {
				child_copyError(undefined, ex);
				throw ex;
			}
		}

		addContextObject(object) {
			try {
				this.notifier.addContextObject(object);
			} catch (ex) {
				console.error("LrExecutor.addContextObject: ignored error: %o", ex);
			}
		}

		addError(err) {
			if (err == null) {
				return;
			}
			if (this._errors === undefined) {
				this._errors = [];
				this._aggregateError = new LrTmpAggregateError(this._errors);
			}
			this._errors.push(err);
		}

		totalError() {
			try {
				let error = null;
				for (let executor = this; executor != null; executor = executor.parent) {
					if (executor._errors == null) {
						continue;
					}
					const curError = ((error !== null ? 1 : 0) + executor._errors.length) === 1 ?
						executor._errors[0] : executor._aggregateError;
					if (error == null) {
						error = curError;
						continue;
					}
					if (curError.errors == null) {
						error = new LrTmpAggregateError([curError, error]);
					} else {
						const newError = Object.create(curError);
						newError.errors = curError.slice();
						newError.errors.push(error);
						error = newError;
					}
				}
				return error;
			} catch (ex) {
				// TODO notify: global warning
				console.error("LrExecutor.totalError: internal error: %o", ex);
			}
			return null;
		}

		ownError() {
			try {
				if (this._errors == null) {
					return this._errors;
				} else if (this._errors.length === 1) {
					return this._errors[0];
				}
				return this._aggregateError.fix();
			} catch (ex) {
				// TODO notify: global warning
				console.error("LrExecutor.ownError: internal error: %o", ex);
			}
		}

		_onException(descr, ex) {
			try {
				descr.error = this._lastError !== ex ? lr_util.errorToObject(ex) : true;
				switch(descr.errorAction) {
					case lr_executor.ERROR_IS_WARNING:
						console.warn("LrExecutor: %o %o", descr.step, ex);
						let warn = ex;
						if (!lr_common.isWarning(ex)) {
							if (ex.errors && ex.toWarning) {
								ex.toWarning();
							} else {
								warn = new LrWarning(undefined, { cause: ex });
							}
						}
						this.addError(warn);
						return;
					case lr_executor.IGNORE_ERROR:
						console.log("LrExecutor: ignored error: %o", ex);
						return;
					default:
						break;
				}
				this._lastError = ex;
				if (this.parent != null) {
					this.parent._lastError = ex;
				}
				if (this.finalized) {
					console.error("LrExecutor: exception in completed instance: %o %o", ex, descr)
				}
			} catch (e) {
				console.error("LrExecutor internal error: %o %o", e, ex);
			}
			throw ex;
		}
	}

	async function run(maybeDescr, ...funcAndArgs) {
		const [runDescr, func, args] = lr_executor._normArgs(maybeDescr, ...funcAndArgs);
		let { notifier, oninit, oncompleted, onerror,  ...callDescr } = runDescr;
		notifier = notifier || new LrNullNotifier();
		const executor = new LrExecutor({ notifier });

		function run_maybeCallback(funcAndDescr, ...args) {
			if (funcAndDescr == null) {
				return;
			}
			const { descriptor, func } = funcAndDescr;
			if (descriptor) {
				return executor.step(descriptor, func, ...args);
			} else {
				return executor.step(func, ...args);
			}
		}

		let totalError;
		function run_setTotalError(ex) {
			try {
				if (totalError === undefined) {
					totalError = executor.totalError();
				}

				if (totalError != null) {
					if (ex == null) {
						ex = totalError;
					} else if (
						totalError instanceof LrTmpAggregateError ||
						totalError instanceof LrAggregateError
					) {
						totalError.errors.push(ex);
						ex = totalError;
					} else {
						ex = totalError = new LrTmpAggregateError([ex, totalError]);
					}
				} else {
					totalError = ex;
				}
			} catch (e) {
				console.error("lr_executor.run.setTotalError: ignored error: %o", e);
			}
			try {
				if (ex) {
					executor.result.error = lr_util.errorToObject(ex);
				}
			} catch (e) {
				console.error("lr_executor.run.saveTotalError: ignored error: %o", e);
			}
			Object.defineProperty(executor.result, "exception", {
				configurable: true,
				enumerable: false,
				value: ex
			});
			return ex;
		}

		try {
			// actually async
			notifier.start();
		} catch (ex) {
			console.error("lr_executor.run: ignored error: notify start: %o", ex);
		}

		let result;
		let status;
		try {
			// Permission requests fail after `await` so treat synchronous
			// functions as a special case to prevent issues with primary `func`.
			const initResult = run_maybeCallback(oninit);
			if (initResult && initResult.then && lr_util.isAsyncFunction(initResult.then)) {
				await initResult;
			}

			result = await executor.step(callDescr, func, ...args);
			run_setTotalError();
			executor.finalized = true;
			status = await run_maybeCallback(oncompleted, result);
		} catch (ex) {
			ex = run_setTotalError(ex);
			try {
				await run_maybeCallback(onerror);
			} catch (callbackEx) {
				ex = run_setTotalError(callbackEx);
			}
			try {
				notifier.error(ex);
			} catch (ignoredEx) {
				console.error("lr_executor.run: ignored error: notify error: %o", ignoredEx);
			}
			return executor.result;
		}

		try {
			switch (status) {
				case null: // fall through
				case undefined:
					if (totalError == null) {
						notifier.completed(result);
					} else {
						notifier.error(totalError);
					}
					break;
				case "success":
					notifier.completed(result);
					break;
				case "preview": // fall through
				case "warning":
					notifier.error(new LrWarning("Export is not completely successful"));
					break;
				default:
					console.warn("Unsupported export status: %o", status);
					notifier.error(new LrWarning("Unsupported export status"));
			}
		} catch (ex) {
			console.error("lr_executor.run: ignored error: notify completed: %o", ex);
		}

		return executor.result;
	};

	Object.assign(lr_executor, {
		LrBrowserActionNotifier,
		LrNullNotifier,
		run,
		_normArgs,
		_internal: {
			LrExecutor,
		}
	});

	return lr_executor;
});

