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

/**
 * Acquire metadata for the current frame
 *
 * `window.location` and `document.title` are obtained by capture.js
 *
 * Returns
 *
 *     { result: {
 *         head: { result: {
 *              url: [
 *                  { value: "https://some.site/", keys: [ "link.canonical", "og:url" ] },
 *              ],
 *              title: [
 *                  { value: "Special page", keys: [ "og:title", "twitter.title" ] },
 *              ],
 *              description: ...
 *              author: ...
 *              image: ...
 *              published_time: ...
 *              modified_time: ...
 *          }},
 *          ld_json: { result: { ... } }
 *     }}
 *
 * Any result could be replaced by
 *
 *     { error: { message, name, ... } }
 *
 * `ld_json.result` could be null if a script element is absent.
 *
 * Text of `html/head/title` element is obtained by the sibling script `capture.js`.
 */

"use strict";

(function meta() {
	/** Error instances could not be passed through `sendMessage()` to backend */
	function lrToObject(obj) {
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
			// browser specific
			for (let prop of ["code", "stack", "fileName", "lineNumber"]) {
				if (obj[prop] != null) {
					error[prop] = ("" + obj[prop]).split("\n");
				}
			}
			return error;
		} else {
			return obj;
		}
	}

	function lrResultOrError(func) {
		try {
			return { result: func() };
		} catch (ex) {
			console.error(ex);
			try {
				return { error: lrToObject(ex) };
			} catch (unexpected) {
				console.error(unexpected);
			}
			return { error: ex };
		}
	}

	function lrCollectDocumentMeta() {
		function lrCollectHeadMeta() {
			const head = document.head;
			if (head == null) {
				return null;
			}
			const map = new Map();

			function setProp(name, value, src, attrs) {
				if (!value) {
					console.debug('empty value for %s %s', name, src);
					return;
				}
				let submap = map.get(name);
				if (!submap) {
					submap = new Map();
					map.set(name, submap);
				}

				let attrMap = submap.get(value);
				if (!attrMap) {
					attrMap = new Map();
					submap.set(value, attrMap);
				}
				for (let [attrName, attrValue] of [["keys", src], ...Object.entries(attrs || {})]) {
					if (attrValue == null || attrValue === "") {
						continue;
					}
					let valueSet = attrMap.get(attrName);
					if (!valueSet) {
						valueSet = new Set();
						attrMap.set(attrName, valueSet);
					}
					valueSet.add(attrValue);
				}
			}

			function langCode(locale) {
				const code = locale.toLowerCase().match(/^[a-z]+/);
				return code ? code[0] : code;
			}

			function getHref(link) {
				const hrefAttr = link.getAttribute('href');
				if (
					!hrefAttr || hrefAttr === "#"
					|| hrefAttr.startsWith("javascript:") || hrefAttr.startsWith("data:")
				) {
					return null;
				}
				return link.href;
			}

			let langs = new Set();
			try {
				for (const navigatorLanguage of navigator.languages || []) {
					const code = langCode(navigatorLanguage);
					if (code) {
						langs.add(code);
					}
				}
			} catch (ex) {
				console.error("LR: trying to get languagers: %s %o", ex, ex);
				langs.add('en');
			}
			for (let link of head.querySelectorAll('link[href]')) {
				const href = getHref(link);
				if (!href) {
					console.debug('empty href in %s', link.outerHTML);
					continue;
				}
				const attrs = {};
				for (const attribute of ['type', 'rel', 'media', 'hreflang', 'title']) {
					attrs[attribute] = link.getAttribute(attribute);
				}
				let source = null;

				switch(attrs.rel) {
				case 'canonical':
				case 'shortlink':
				case 'shorturl':
					source = `link.${attrs.rel}`;
					break;
				case 'alternate':
					if (attrs.type) {
						console.debug('ignore link rel="alternate" type="%s" href="%s"',
							attrs.type, href);
					} else if (attrs.hreflang) {
						if (langs.has(langCode(attrs.hreflang))) {
							source = 'link.alternate';
						}
					} else {
						source = 'link.alternate';
					}
					break;
				case 'image_src':
					setProp('image', href, 'link.image_src');
					break;
				default:
					break;
				}
				delete attrs.rel;
				if (source) {
					setProp('url', href, source, attrs);
				}
			}

			const nameMap = new Map([
				['description', 'description'],
				['author', 'author'],
				['mediator_author', 'author'],
				['datePublished', 'published_time'],
				['dateModified', 'modified_time'],
				['blog-name', 'site_name'],
				['twitter:site', 'site_name'],
			]);
			const propertyMap = new Map([
				['og:url', 'url'],
				['og:title', 'title'],
				['twitter:title', 'title'],
				['og:description', 'description'],
				['twitter:description', 'description'],
				['article:published_time', 'published_time'],
				['article:modified_time', 'modified_time'],
				['og:updated_time', 'modified_time'],
				['article:publisher', 'publisher'],
				['og:image:secure_url', 'image'],
				['og:image', 'image'],
				['vk:image', 'image'],
				['twitter:image', 'image'],
				['og:site_name', 'site_name'],
				/* TODO og:type article, website */
			]);
			const itempropMap = new Map([
				['datePublished', 'published_time'],
			]);
			/* TODO author
			 * wordpress: body span.author
			 */

			for (let meta of head.querySelectorAll('meta')) {
				let content = meta.getAttribute('content');
				if (!content) {
					if (!meta.hasAttribute('charset')) {
						console.debug('LR.meta: Empty content for %s', meta.outerHTML);
					}
					continue;
				} else {
					content = content.trim();
				}
				const name = meta.getAttribute('name');
				const property = meta.getAttribute('property');
				const itemprop = meta.getAttribute('itemprop');
				if (name) {
					const target = nameMap.get(name) || propertyMap.get(name);
					if (target) {
						setProp(target, content, 'meta.name.' + name);
					}
				} else if (property) {
					const target = propertyMap.get(property);
					if (target) {
						setProp(target, content, 'meta.property.' + property);
					}
				} else if (itemprop) {
					const target = itempropMap.get(itemprop);
					if (target) {
						setProp(target, content, 'itemprop.' + itemprop);
					}
				}
			}
			return map;
		}

		function lrSerializeMeta(resultMap) {
			if (!resultMap instanceof Map) {
				return resultMap;
			}
			const result = Object.create(null);
			for (let [key, valueMap] of resultMap.entries()) {
				const variants = [];
				for (let [value, attrMap] of valueMap.entries()) {
					const valueObj = { value };
					for (const [attrName, attrValues] of attrMap.entries()) {
						valueObj[attrName] = Array.from(attrValues);
					}
					variants.push(valueObj);
				}
				result[key] = variants;
			}
			return result;
		}

		function lrGetLD_JSON() {
			const scriptList = document.querySelectorAll('script[type="application/ld+json"]');
			const warnings = [];
			if (scriptList == null || !(scriptList.length > 0)) {
				return null;
			}
			if (scriptList.length != 1) {
				const msg = `non-unique script ld+json object, count=${scriptList.length}`;
				console.warn("lr_ld_json: " + msg);
				// warnings.push(msg); // FIXME
			}
			return JSON.parse(scriptList[0].innerText);
		}

		return {
			head: lrResultOrError(() => lrSerializeMeta(lrCollectHeadMeta())),
			ld_json: lrResultOrError(lrGetLD_JSON),
		};
	}

	return lrResultOrError(lrCollectDocumentMeta);
})();
