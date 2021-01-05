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

var lr_test = lr_util.namespace("lr_test", lr_test, function(){
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

	this.run = function(...args) {
		if (args.length === 0) {
			args = this.suites;
		}
		const collector = new LrTestCollector();
		for (const obj of args) {
			this.runObject(obj, collector);
		}
		collector.report();
	};

	this.runObject = function(obj, collector) {
		const suite = this.suiteName(obj);
		collector.suiteStart(suite);
		for (const [prop, value] of Object.entries(obj)) {
			if (!prop.startsWith("test_")) {
				continue;
			}
			this.runMaybeParametrized(obj, value, collector);
		}
		collector.suiteDone(suite);
	};

	this.runMaybeParametrized = function(obj, method, collector) {
		if (lr_util.isGeneratorFunction(method)) {
			for (const test of method()) {
				this.runMaybeParametrized(obj, test, collector);
			}
		} else {
			return this.runCase(obj, method, collector);
		}
	};

	this.suiteName = function(obj) {
		const proto = Object.getPrototypeOf(obj);
		return "" + ((proto && proto.constructor && proto.constructor.name) || proto || obj);
	};

	this.runCase = function(obj, meth, collector) {
		const name = this.suiteName(obj) + '.' + meth.name;
		try {
			collector.start(name);
			meth.call(obj);
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
			}
		};
		lr_util.setFuncName(retval, func.name);
		return retval;
	};

	this.assertEq = function(a, b, msg) {
		if (a != b) {
			const message = msg == null ? "not equal" : "" + msg;
			throw new LrAssertionError(`Assert ${a} == ${b} failed: ${message}`);
		}
	};

	this.suites = [];
	return this;
});
