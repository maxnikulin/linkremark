/*
   Copyright (C) 2020-2022 Max Nikulin

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
 * Logger similar to `console`, but with configurable verbosity.
 *
 * Limitation: Tag and %-formatters can not be used simultaneously.
 */
class MwelConsole {
	drop() {}
	constructor(tag, level = 20) {
		this._tag = this._tagValue(tag);
		// implicit reconfigure
		this.level = level;
	}
	get tag() {
		return this._tag;
	}
	set tag(tag) {
		this._tag = this._tagValue(tag);
		this._reconfigure();
	}
	get level() {
		return this._level;
	}
	set level(level) {
		const value = (typeof level === "string")
			? this[level.toUpperCase()] : level;
		if (typeof value === "number") {
			this._level = value;
		} else {
			console.warn(`MwelConsole ${this._tag}: incorrect level`, level);
			this._level =this.LOG;
		}
		this._reconfigure();
	}
	_tagValue(tag) {
		if (tag === undefined || tag === null || tag === "") {
			return undefined;
		} else if (typeof tag !== "string") {
			console.warn("MwelConsole: incorrect tag type", tag);
			return undefined;
		}
		return tag;
	}
	_reconfigure() {
		const level = this._level;
		const args = [console];
		const tag = this._tag;
		if (tag !== undefined) {
			args.push(tag);
		}
		for (const name of ['debug', 'info', 'log', 'warn', 'error']) {
			const loggerLevel = this[name.toUpperCase()];
			Object.defineProperty(this, name, {
				value: loggerLevel < level
					? this.drop : console[name].call.bind(console[name], ...args),
				enumerable: true,
				configurable: true,
			});
		}
	}
}

try {
	for (
		const [level, value]
		of [["DEBUG", 0], ["INFO", 10], ["LOG", 20], ["WARN", 30], ["ERROR", 40]]
	) {
		const prop ={
			enumerable: true,
			writable: false,
			configure: true,
			value,
		};
		Object.defineProperty(MwelConsole, level, prop);
		Object.defineProperty(MwelConsole.prototype, level, prop);
	}
} catch (ex) {
	// Ignore exception, but let it appear in errors collected for Chrome extensions.
	Promise.reject(ex);
}
