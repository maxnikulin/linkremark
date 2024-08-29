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

/*
 * Consider this file as an excercise to provide something similar to
 * https://github.com/mozilla/webextension-polyfill
 * WebExtension browser API Polyfill
 * Mozilla project.
 *
 * This files provides `bapi` global object
 * that is exactly `browser` in Firefox
 * or an object with some methods from `chrome` wrapped to
 * return promises if necessary. Support of Chrome is incomplete.
 */

"use strict";

/* Assuming Firefox, may cause problems with Edge (Chakra). */
var bapi = typeof browser !== 'undefined' ? browser : null;
var bapiType;

if (bapi) {
	bapiType = 'firefox';
} else if (typeof chrome !== "undefined") {
	bapi = bapiChrome(chrome);
	bapiType = 'chrome';
} else {
	bapiType = 'unknown';
	throw new Error("LinkRemark: unsupported browser");
}

function bapiChrome(chrome) {
	const asis = Symbol("asis");
	const targetMap = new WeakMap();

	class EventWithSendResponse {
		constructor(origEvent) {
			this.origEvent = origEvent;
		};
		addListener(mozillaStyleListener) {
			if (!this.listenerMap) {
				this.listenerMap = new WeakMap();
			}
			var callMozillaStyleListener = mozillaStyleListener;
			function chromeStyleListener(message, sender, sendResponse) {
				var result = callMozillaStyleListener(message, sender, sendResponse);
				if (result && result.then) {
					result.then(function onResolve(message) { sendResponse(message); })
						.catch(err => console.error(err));
					return true;
				}
				return result;
			}
			this.listenerMap.set(mozillaStyleListener, chromeStyleListener);
			this.origEvent.addListener(chromeStyleListener);
		};

		hasListener(mozillaStyleListener) {
			return this.listenerMap &&
				this.origEvent.hasListener(this.listenerMap.get(mozillaStyleListener));
		};

		removeListener(mozillaStyleListener) {
			if (this.listenerMap) {
				this.origEvent.removeListener(this.listenerMap.get(mozillaStyleListener));
				this.listenerMap.delete(mozillaStyleListener);
			}
		};
	};

	function promisifyEventWithResponse(target, prop) {
		return new EventWithSendResponse(Reflect.get(target, prop));
	};

	var methods = {
		browserAction: "action",
		commands: asis,
		contextMenus: asis,
		i18n: asis,
		permissions: asis,
		runtime: {
			lastError: asis,
			connect: asis,
			connectNative: asis,
			getManifest: asis,
			id: asis,
			getURL: asis,
			onConnect: asis,
			onInstalled: asis,
			onStartup: asis,
			reload: asis,
			sendMessage: asis,
			openOptionsPage: asis,
			onMessage: promisifyEventWithResponse,
		},
		// `chrome.scripting.executeScript` returns `undefined` in Firefox mv2 extensions
		// so it is impossible to use `chrome` directly instead of `bapi`.
		scripting: {
			executeScript: asis,
		},
		storage: asis,
		tabs: asis,
		tabGroups: asis,
		windows: asis,
		webNavigation: asis,
	};

	class BapiHandler {
		constructor(propertyMap) {
			this._propertyMap = propertyMap;
			this._cache = new Map();
		}
		get(target, property) {
			const mapping = this._propertyMap[property];
			if (mapping === undefined) {
				return undefined;
			}
			const isAlias = typeof mapping === "string";
			const targetName = isAlias ? mapping : property;
			const targetProperty = Reflect.get(target, targetName);
			if (targetProperty === undefined) {
				// revoked permission
				this._cache.delete(property)
				return targetProperty;
			}
			if (isAlias || mapping === asis) {
				return targetProperty;
			}
			let cached = this._cache.get(property);
			if (cached === undefined) {
				if (typeof mapping === 'function') {
					cached = mapping(target, property);
				} else {
					cached = new Proxy(targetProperty, new BapiHandler(mapping));
					targetMap.set(cached, targetProperty);
				}
				this._cache.set(property, cached);
			}
			return cached;
		}
		has(target, property) {
			const mapping = this._propertyMap[property];
			if (mapping === undefined) {
				return mapping;
			}
			return Reflect.has(target, typeof mapping === "string" ? mapping : property);
		}
		// Added with hope to improve debugging experience in Chromium,
		// it does not affect completion in console however.
		ownKeys(target) {
			const set = new Set(Reflect.ownKeys(target));
			console.log(Object.entries(this._propertyMap)
				.map((k, v) => set.has(typeof v === "string" ? v : k) ? k : undefined)
				.filter(k => k !== undefined));
			return Object.entries(this._propertyMap)
				.map((k, v) => set.has(typeof v === "string" ? v : k) ? k : undefined)
				.filter(k => k !== undefined);
		}
	}
	return new Proxy(chrome, new BapiHandler(methods));
}
