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

var lr_test = lr_util.namespace(lr_test, function lr_test(){
	var lr_test = this;
	class LrAssertionError extends Error {
	};

	class LrTestCollector {
		constructor() {
			this.stat = {};
			for (const prop of ["pass", "fail", "error"]) {
				this.simpleProperty(prop);
			}
		};
		simpleProperty(name) {
			this.stat[name] = 0;
			this[name] = function(test) {
				++this.stat[name];
				if (this.verbose) {
					console.log("%s: %s", test, name);
				}
			}
		};
		start(test) {
			if (this.verbose) {
				console.log("%s...", test);
			}
		};
		suiteStart(name) {
			console.log(`Suite ${name}...`);
		};
		suiteDone(name) {
			console.log(`Suite ${name} Done`);
		}
		report() {
			console.log(Object.entries(this.stat).map(x => `${x[0]}: ${x[1]}`).join(" "));
		};
	}

	this.run = async function(...args) {
		if (args.length === 0) {
			args = this.suites;
		}
		const collector = new LrTestCollector();
		for (const obj of args) {
			await this.runObject(obj, collector);
		}
		collector.report();
	};

	this.runObject = async function(obj, collector) {
		const suite = this.suiteName(obj);
		collector.suiteStart(suite);
		for (const [prop, value] of Object.entries(obj)) {
			if (!prop.startsWith("test_")) {
				continue;
			}
			await this.runMaybeParametrized(obj, value, collector);
		}
		collector.suiteDone(suite);
	};

	this.runMaybeParametrized = async function(obj, method, collector) {
		if (lr_util.isGeneratorFunction(method)) {
			for (const test of method()) {
				await this.runMaybeParametrized(obj, test, collector);
			}
		} else {
			return await this.runCase(obj, method, collector);
		}
	};

	this.suiteName = function(obj) {
		const proto = Object.getPrototypeOf(obj);
		return "" + ((proto && proto.constructor && proto.constructor.name) || proto || obj);
	};

	this.runCase = async function(obj, meth, collector) {
		const name = this.suiteName(obj) + '.' + meth.name;
		try {
			collector.start(name);
			await meth.call(obj);
			collector.pass(name);
		} catch (ex) {
			console.error("%s: %o", name, ex);
			if (ex instanceof LrAssertionError) {
				collector.fail(name, ex);
			} else {
				collector.error(name, ex);
			}
		}
	};

	this.parametrize = function(iterable, func) {
		if (!func.name) {
			console.warn("lr_test.parametrize: argument has no name");
		}
		const retval = function*() {
			var arg;
			const call = function() {
				if (Array.isArray(arg)) {
					return func.apply(this, arg);
				} else {
					return func.call(this, arg);
				}
			}
			let i = 0;
			for (arg of iterable) {
				lr_util.setFuncName(call, `${func.name}[${i}: ${arg}]`);
				yield call;
				++i;
			}
		};
		lr_util.setFuncName(retval, func.name);
		return retval;
	};

	function assignParametrized(obj, iterable, func) {
		if (!func.name) {
			throw new Error("Function has no name");
		}
		return Object.assign(obj, { [func.name]: lr_test.parametrize(iterable, func) });
	}

	this.assertEqSet = function(a, b) {
		if (!(a instanceof Set) && !(b instanceof Set)) {
			return undefined;
		}
		if (!(a instanceof Set)) {
			[b, a] = [a, b];
		}
		if (!b || !b[Symbol.iterator]) {
			throw new LrAssertionError("Counterpart of Set is not iterable");
		}
		let n = 0;
		for (const element of b) {
			if (!a.has(element)) {
				throw new LrAssertionError(`Element ${element} is missed`);
			}
			++n;
		}
		if (n !== a.size) {
			throw new LrAssertionError(`Set sizes ${n} !== ${a.size}`);
		}
		return true;
	};

	this.assertIterablesEq = function(a, b) {
		const itB = b[Symbol.iterator]();
		for (const eA of a) {
			const { value, done } = itB.next();
			if (done) {
				throw new LrAssertionError(`B exhausted ${eA}: ${a}, ${b}`);
			}
			if (eA != value) {
				throw new LrAssertionError(`${eA} != ${value} in [${a}], [${b}]`);
			}
		}
		const { value, done } = itB.next();
		if (!done) {
			throw new LrAssertionError(`A exhausted ${value}: ${a}, ${b}`);
		}
		return true;
	}

	this.assertEq = function(a, b, msg) {
		try {
			for (const comparator of [this.assertEqSet]) {
				const result = comparator(a, b);
				if (result === undefined) {
					continue;
				} else if (!result) {
					throw new LrAssertionError(`Comparator ${comparator.name} returned false`);
				} else {
					return true;
				}
			}
		} catch (ex) {
			if (ex instanceof LrAssertionError) {
				const message = msg == null ? "not equal" : "" + msg;
				throw new LrAssertionError(`Assert ${a} == ${b} failed: ${ex}: ${message}`);
			}
			throw ex;
		}
		if (a !== b) {
			const message = msg == null ? "not equal" : "" + msg;
			throw new LrAssertionError(`Assert ${a} == ${b} failed: ${message}`);
		}
	};

	this.assertTrue = function(value, ...params) {
		if (lr_util.isFunction(value)) {
			const result = value();
			if (!result) {
				const msg = `Assert "${result}" is not true: ${value} ${params}`;
				throw new LrAssertionError(msg);
			}
		} else {
			if (!value) {
				const msg = `Assert ${value} is not true: ${params}`;
				throw new LrAssertionError(msg);
			}
		}
	};

	lr_test.assertThrows = function assertThrows(expect, func, ...params) {
		function _name() {
			return func.name || String(func).substring(0, 40);
		}
		function _lr_test_assertThrows_assertException(ex) {
			if (expect instanceof Error) {
				if (expect === ex) {
					return;
				}
			} else {
				try {
					if (expect instanceof ex) {
						return;
					}
				} catch (ex) {
					const msg = `Assert throws: invalid expect ${expect} for ${_name()} ${params}`;
					throw new TypeError(msg, { cause: ex });
				}
			}
			const msg = `Assert throws ${expect} != ${ex} for ${_name()} ${params}`;
			throw new LrAssertionError(msg);
		}
		async function _lr_test_assertThrowsAsync() {
			try {
				await func();
			} catch(ex) {
				return _lr_test_assertThrows_assertException(ex);
			}
			const msg = `Assert throws ${expect} failed for ${_name()} ${params}`;
			throw new LrAssertionError(msg);
		}

		if (lr_util.isAsyncFunction(func)) {
			return _lr_test_assertThrowsAsync();
		} else if (!lr_util.isFunction(func)) {
			const msg = `Assert throws: not a function ${_name()} ${params}`;
			throw new TypeError(msg);
		}
		try {
			func();
		} catch (ex) {
			return _lr_test_assertThrows_assertException(ex);
		}
		const msg = `Assert throws ${expect} failed for ${_name()} ${params}`;
		throw new LrAssertionError(msg);
	};

	this.suites = [];

	function withExecutor(func, ...args) {
		if (!lr_util.isFunction(func)) {
			throw new TypeError("func must be a synchronous function");
		}
		const executor = new lr_executor._internal.LrExecutor({
			notifier: new lr_executor.LrNullNotifier(),
			ctx: {
				throwIfAborted() {},
				abortable(promise) {
					console.error("Async call of abortable context mock");
					return promise;
				},
			},
		});
		try {
			executor.execInfo.result = executor.step(func, ...args);
		} catch (ex) {
			executor.execInfo.exception = ex;
		} finally {
			executor.execInfo.error = executor.totalError();
		}
		return executor.execInfo;
	}

	Object.assign(this, {
		withExecutor,
		assignParametrized,
	});
	return this;
});
