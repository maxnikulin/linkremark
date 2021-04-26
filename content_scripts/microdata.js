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

/**
 * Get schema.org microdata embedded in HTML
 *
 * Walk through DOM tree and try to build a structure similar to JSON-LD
 * from elements having "itemprop", "itemscope", and "itemtype" attributes.
 *
 * TODO: Limit amount of collected data.
 */
"use strict";

(function lrMicrodata(){

	/** Make Error instance fields available to backend scripts */
	function lrToObject(obj) {
		console.error(obj);
		if (obj instanceof Error) {
			var error = Object.create(null);
			if (obj.message != null) {
				error.message = obj.message;
			} else {
				error.message = "" + obj;
			}
			if (obj.name != null) {
				error.name = "" + obj.name;
			} else {
				error.name = Object.prototype.toString.call(obj);
			}
			for (let prop of ["code", "stack", "fileName", "lineNumber", "columnNumber"]) {
				const value = obj[prop];
				if (value == null) {
					continue;
				}
				if (typeof value !== "string") {
					error[prop] = value;
					continue;
				}
				// Make `stack` readable in `JSON.stringify()` dump.
				const lines = value.split("\n");
				error[prop] = lines.length > 1 ? lines : value;
			}
			return error;
		} else {
			return obj;
		}
	}

	class LrMultiMap extends Map {
		set(key, value) {
			let entry = super.get(key);
			if (entry === undefined) {
				entry = new Set();
				super.set(key, entry);
			}
			entry.add(value);
		}
		hasValue(value) {
			for (const set of super.values()) {
				if (set.has(value)) {
					return true;
				}
			}
			return false;
		}

		toJSON() {
			// nulls are better for debug since `JSON.stringify` does not skip them
			let named = null;
			let unnamed = null;
			for (let [key, value] of this) {
				value = Array.from(value, e => (e instanceof LrMultiMap ? e.toJSON() : e));
				value = value.length > 1 ? value : value[0];
				if (key == null) {
					unnamed = value;
				} else {
					if (named === null) {
						named = {};
					}
					named[key] = value;
				}
			}
			if (named) {
				if (unnamed) {
					named["@unnamed"] = unnamed;
				}
				return named;
			}
			return unnamed;
		}
	}

	function QueueItem(node) {
		this.node = node; this.post = false;
	}

	function* lrDeepFirstSearch(root) {
		const queue = [new QueueItem(root)];
		while (queue.length > 0) {
			const item = queue.pop();
			const children = yield item;
			if (!item.post) {
				item.post = true;
				queue.push(item);
			}
			if (children) {
				queue.push.apply(
					queue,
					Array.from(children, x => new QueueItem(x)).reverse());
			}
		}
	}

	function lrArrayLast(array) {
		return array.length > 0 ? array[array.length - 1] : undefined;
	}

	function lrCollectMicrodata() {
		const metaFrameStack = [ { node: undefined, properties: new LrMultiMap() } ];
		const stack = []
		let item;
		let children;
		const iter = lrDeepFirstSearch(document.documentElement);
		while (!(item = iter.next(children)).done) {
			children = null;
			const { node, post } = item.value;
			/*
			if (
				node.hasAttribute("itemprop")
				|| node.hasAttribute("itemscope")
				|| node.hasAttribute("itemtype")
				|| node.tagName === "meta"
			) {
				console.log("--".repeat(stack.length), node);
			}
			*/
			if (post) {
				const stackItem = stack.pop();
				console.assert(stackItem === node, stackItem, node);
				const topMetaFrame = lrArrayLast(metaFrameStack);
				if (topMetaFrame && topMetaFrame.node === node) {
					metaFrameStack.pop();
					const prop = {};
					if (topMetaFrame.properties.size > 0) {
						let id = lrNodeId(node);
						if (topMetaFrame.properties.hasValue(id)) {
							id = null;
						}
						if (id) {
							prop.name = "@id";
							prop.value = id;
						}
					} else {
						prop.name = null;
						let href = node.getAttribute("href") && node.href;
						const text = node.nodeName === "TEXTAREA" ? node.textContent : node.innerText;
						if (href) {
							prop.value = href;
						} else if (text) {
							prop.value = text.substring(0, 4096);
						}
					}
					if (prop.value) {
						topMetaFrame.properties.set(prop.name, prop.value);
					}
				}
				continue;
			}
			stack.push(node);
			const itemscope = node.hasAttribute("itemscope");
			const itemprop = node.getAttribute("itemprop");
			children = node.children;
			if (itemscope || itemprop) {
				const topMetaFrame = lrArrayLast(metaFrameStack);
				const newFrame = { node, properties: new LrMultiMap() };
				topMetaFrame.properties.set(itemprop, newFrame.properties);
				metaFrameStack.push(newFrame);
				if (itemscope) {
					const typeAttr = node.getAttribute("itemtype");
					const type = typeAttr && typeAttr.replace(/^https?:\/\/schema\.org\//, "");
					if (type) {
						newFrame.properties.set("@type", type);
					}
				} else if (itemprop) {
					const value = lrNodeContentFromAttributes(node);
					if (value) {
						newFrame.properties.set(null, value);
					}
				}
			}
		}
		return metaFrameStack[0].properties.toJSON();
	}

	function lrNodeId(node) {
		// not hasAttribute to ignore empty string
		const href = (node.getAttribute("href") && node.href);
		if (href) {
			return href;
		}
		const name = node.nodeName.toUpperCase();
		const id = node.getAttribute("id") ||
			(name === "A" && node.getAttribute("name"));
		if (id) {
			return "" + new URL("#" + id, node.baseURI)
		}
		return undefined;
	}

	function lrNodeContentFromAttributes(node) {
		const name = node.nodeName.toUpperCase();
		switch (name) {
			case "META":
				return node.getAttribute("content");
			case "LINK":
				// not hasAttribute to ignore empty string
				return node.getAttribute("href") && node.href;
			case "TIME":
				if (node.dateTime) {
					return node.dateTime;
				}
				try {
					// non-standard cases
					const ts = parseInt(node.dataset.unix, 10);
					if (!isNaN(ts)) {
						return new Date(ts*1000).toISOString();
					}
				} catch (ex) {
					// Unsure that I could check all possibilities to get Invalid Date.
					// `toISOString` throws an exception for invalid dates.
					console.error("LR: getting value for time element: %o", ex);
				}
				return node.getAttribute("content") || node.getAttribute("datetime");
			default:
				return undefined;
		}
	}

	try {
		return { result: lrCollectMicrodata() };
	} catch (ex) {
		return { error: lrToObject(ex) };
	}
	return { error: "LR internal error: microdata.js: should not reach end of the function" };
})();
