/*
   Copyright (C) 2020 Max Nikulin

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
	bapi = bapiChrome({}, window.chrome);
	bapiType = 'chrome';
} else {
	bapiType = 'unknown';
	throw new Error("LinkRemark: unsupported browser");
}

function bapiChrome(bapi, chrome) {
	function asis(method) {
		return method;
	}

	function promisify(method, src) {
		const func = function(...args) {
			var error = new Error();
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
		};
		Object.defineProperty(func, "name", { value: method.name, configurable: true });
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

	function promisifyEventWithResponse(origEvent) {
		return new EventWithSendResponse(origEvent);
	};

	var methods = { 
		browserAction: {
			onClicked: asis, /*{
				addListener: asis,
			}, */
		},
		commands: {
			onCommand: asis /* {
				addListener: asis,
			}, */
		},
		contextMenus: {
			create: asis,
			onClicked: asis,
		},
		runtime: {
			connectNative: asis,
			getManifest: asis,
			id: asis,
			getURL: asis,
			onInstalled: asis,
			sendMessage: promisify,
			getPlatformInfo: promisify,
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
			query: promisify,
			remove: promisify,
			update: promisify,
		},
		webNavigation: {
			getAllFrames: promisify,
		},
	};

	function mapRecursive(target, src, map) {
		var transform;
		var branch;
		for (var name in map) {
			if (!Object.prototype.hasOwnProperty.call(src, name)) {
				console.warn("unknown property", name);
				continue;
			}
			transform = map[name];
			if (typeof transform === 'function') {
				target[name] = transform(src[name], src, name);
			} else {
				const proto = function() {};
				Object.defineProperty(proto, 'name', {
					value: name,
					configurable: true,
					enumerable: false,
				});
				branch = target[name] = new proto();
				mapRecursive(branch, src[name], transform);
			}
		}
	}

	mapRecursive(bapi, chrome, methods);
	Object.defineProperty(bapi.runtime, "lastError", {
		enumerable: true,
		configurable: true,
		get() { return chrome.runtime.lastError },
		set(value) { return chrome.runtime.lastError = value },
	});
	return bapi;
}

/**
 * runtime.sendMessage wrapper for communication similar to JSON-RPC
 *
 * Actually it is simplified version of protocol.
 * Successful response have `response` field.
 * Otherwise promise is rejected either using `error` field
 * or just stating that onMessage handler does not follow the rules.
 */
async function lrSendMessage(method, params) {
	const response = await bapi.runtime.sendMessage({ method, params });
	if (response != null && response.result) {
		return response.result;
	} else if (response != null && response.error) {
		throw new Error(response.error);
	}
	console.error("lrSendMessage: invalid response", response);
	throw new Error ("Invalid response object");
}
