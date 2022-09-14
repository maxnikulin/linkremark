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
} else if (window.chrome) {
	bapi = bapiChrome(window.chrome);
	bapiType = 'chrome';
} else {
	bapiType = 'unknown';
	throw new Error("LinkRemark: unsupported browser");
}

function bapiChrome(chrome) {
	const asis = Symbol("asis");
	const targetMap = new WeakMap();

	function promisify(target, property) {
		const method = Reflect.get(target, property);
		const name = method.name || "promisifyWrapper";
		const obj = {[name]: function(...args) {
			var error = new Error();
			// Unsure if _target is guarantied to survive
			// after permission revocation and grant again.
			const src = targetMap.get(this) || this;
			return new Promise(function(resolve, reject) {
				try {
					method.call(src, ...args, function(result) {
						if (chrome.runtime.lastError != null) {
							const err = chrome.runtime.lastError;
							if (err && !(err instanceof Error) && err.message) {
								error.message = err.message;
								reject(error);
							} else {
								reject(err);
							}
						} else {
							resolve(result);
						}
					});
				} catch (e) {
					reject(e);
				}
			});
		} };
		const func = obj[name];
		Object.defineProperty(func, "name", { value: name, configurable: true });
		return func;
	}

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
		browserAction: {
			onClicked: asis, /*{
				addListener: asis,
			}, */
			/* Hidden behind a flag in Chrome, invokes `onClicked` listeners
			 * in Firefox-92 if popup is empty string "". */
			openPopup: promisify,
			setTitle: promisify,
			setBadgeText: promisify,
			setBadgeBackgroundColor: promisify,
			setPopup: promisify,
		},
		commands: {
			onCommand: asis /* {
				addListener: asis,
			}, */
		},
		contextMenus: {
			ContextType: asis, // "TAB" feature detection in Firefox
			create: asis,
			removeAll: promisify,
			update: promisify,
			onClicked: asis,
		},
		i18n: {
			getMessage: asis,
			// getUILanguage: asis, // Unsure if it is better than navigator.language
		},
		permissions: {
			contains: promisify,
			getAll: promisify,
			remove: promisify,
			request: promisify,
			onAdded: promisifyEventWithResponse,
			onRemoved: promisifyEventWithResponse,
		},
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
			sendMessage: promisify,
			getPlatformInfo: promisify,
			openOptionsPage: promisify,
			onMessage: promisifyEventWithResponse,
		},
		storage: {
			local: {
				set: promisify,
				get: promisify,
			},
			onChanged: asis,
		},
		tabs: {
			create: promisify,
			// compatibility: Chrome >= 39, Firefox >= 43
			executeScript: promisify,
			// Feature detection in Chrome. `tabGroups` to get name of group available for manifest v3 only.
			group: promisify,
			get: promisify,
			query: promisify,
			remove: promisify,
			update: promisify,
		},
		windows: {
			update: promisify,
		},
		webNavigation: {
			getAllFrames: promisify,
		},
		// `chrome.scripting.executeScript` returns `undefined` in Firefox mv2 extensions
		// so it is impossible to use `chrome` directly instead of `bapi`.
		scripting: {
			executeScript: asis,
		},
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
			const targetProperty = Reflect.get(target, property);
			if (targetProperty === undefined) {
				// revoked permission
				this._cache.delete(property)
				return targetProperty;
			}
			if (mapping === asis) {
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
			return this._propertyMap[property] !== undefined && Reflect.has(target, property);
		}
		// Added with hope to improve debugging experience in Chromium,
		// it does not affect completion in console however.
		ownKeys(target) {
			const set = new Set(Reflect.ownKeys(target));
			return Object.keys(this._propertyMap).filter(k => set.has(k));
		}
	}
	return new Proxy(chrome, new BapiHandler(methods));
}

const bapiGetId = function(init) { return () => init++; } (Date.now());
/**
 * runtime.sendMessage wrapper for communication similar to JSON-RPC
 *
 * Actually it is simplified version of protocol.
 * Successful response have `response` field.
 * Otherwise promise is rejected either using `error` field
 * or just stating that onMessage handler does not follow the rules.
 */
async function lrSendMessage(method, params) {
	const response = await bapi.runtime.sendMessage({ id: bapiGetId(), method, params });
	if (response != null) {
		if (response._type === "ExecInfo") {
			return response;
		} else if ("result" in response) {
			return response.result;
		} else if ("error" in response) {
			throw new Error(response.error);
		}
	}
	console.error("lrSendMessage: invalid response", response);
	throw new Error ("Invalid response object");
}
