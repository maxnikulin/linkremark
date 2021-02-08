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
 * Returns
 *
 *     { error: { message, name, ... } }
 *
 * or
 *
 *     { result: [ Descriptor... ] }
 *
 * where Descriptor could have the following fields
 *
 *     { property, value, key, error }
 *
 * and some other attributes.
 *
 * - Properties: url, title, description, author, image, published_time, modified_time, json_ld.
 *   Non-critical errors no associated with particular entry are reported
 *   with "warning" property.
 * - Examples:
 *
 *        { property: "url", value: "https://some.site/", key: "link.canonical" },
 *        { property: "url", value: "https://some.site/", key: "og:url" },
 *        { property: "title", value: "Special page", key: "og:title" },
 *        { property: "title", value: "Special page", key: "twitter.title" },
 *
 * `window.location`, and `document.title` (text of `html/head/title` element)
 * are obtained by `capture.js`.
 */

"use strict";

(function lrMeta() {

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

	function LrOverflowError(size) {
		self = this || {};
		self.name = "LrOverflowError";
		if (typeof size === "number") {
			self.size = size;
		} else {
			self.message = size;
		}
		return self;
	}

	const DEFAILT_SIZE_LIMIT = 1000;
	const TEXT_SIZE_LIMIT = 4000;
	console.assert(TEXT_SIZE_LIMIT >= DEFAILT_SIZE_LIMIT, "text length limits should be consistent");

	function lrNormalize(value, sizeLimit) {
		sizeLimit = sizeLimit || DEFAILT_SIZE_LIMIT;
		const t = typeof value;
		if (value == null || t === "boolean" || t === "number") {
			return { value };
		}
		if (t !== "string" && value.toString === Object.prototype.toString) {
			// [object Object] is obviously useless
			throw TypeError("Not a string and has no toString");
		}
		value = "" + value;
		if (!(value.length <= sizeLimit)) {
			const error = new LrOverflowError(value.length);
			value = value.substring(0, sizeLimit);
			return { value, error }
		}
		return { value };
	}

	function lrPushProperty(array, getter, props) {
		props = props || {};
		const retval = { key: props.key || "unspecified." + (getter && getter.name) };
		try {
			const [ value, error ] = lrNormalize(getter(), props.sizeLimit);
			if (value != null || props.forceNull) {
				retval.value = value;
			}
			if (error) {
				retval.error = error;
			}
			if (!props.key) {
				throw new Error("Missed property key");
			}
		} catch (ex) {
			retval.error = lrToObject(ex);
		}
		if (retval.hasOwnProperty("value") || retval.error != null) {
			array.push(retval);
		}
	}

	function lrExtractHeadLinks(array) {
		const head = document.head;
		if (head == null) {
			return null;
		}

		function langCode(locale) {
			const code = locale && locale.toLowerCase().match(/^[a-z]+/);
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
			array.push({ property: 'warning', key: 'lr.head.languages', error: lrToObject(ex) });
			langs.add('en');
		}

		function lrExtractLink(array, link) {
			const href = getHref(link);
			if (!href) {
				console.debug('empty href in %s', link.outerHTML);
				return;
			}
			const attrs = {};
			for (const attribute of ['type', 'rel', 'media', 'hreflang', 'title']) {
				const attrValue = link.getAttribute(attribute);
				if (attrValue && attrValue.length < DEFAILT_SIZE_LIMIT) {
					attrs[attribute] = attrValue;
				}
			}

			switch(attrs.rel) {
			case 'canonical':
			case 'shortlink':
			case 'shorturl':
				attrs.key = `link.${attrs.rel}`;
				attrs.property = 'url';
				break;
			case 'alternate':
				attrs.property = 'url';
				if (attrs.type) {
					console.debug('ignore link rel="alternate" type="%s" href="%s"',
						attrs.type, href);
				} else if (attrs.hreflang) {
					if (langs.has(langCode(attrs.hreflang))) {
						attrs.key = 'link.alternate';
					}
				} else {
					attrs.key = 'link.alternate';
				}
				break;
			case 'image_src':
				attrs.property = 'image';
				attrs.key = 'link.image_src';
				break;
			default:
				break;
			}
			if (attrs.key) {
				Object.assign(attrs, lrNormalize(href));
				array.push(attrs);
			}
		}

		for (let link of head.querySelectorAll('link[href]')) {
			try {
				lrExtractLink(array, link);
			} catch (ex) {
				array.push({ 'property': 'warning', key: 'lr.head.link', error: lrToObject(ex) });
			}
		}

	}

	function lrExtractLD_JSON(item) {
		const scriptList = document.querySelectorAll('script[type="application/ld+json"]');
		if (scriptList == null || !(scriptList.length > 0)) {
			return null;
		}
		if (scriptList.length != 1) {
			item.error = {
				name: 'LrValueError',
				message: 'Non-unique script ld+json object',
				count: scriptList.length,
			}
		}
		const strValue = scriptList[0].innerText;
		if (!(strValue.length < 8*TEXT_SIZE_LIMIT)) {
			item.error = new LrOverflowError(strValue.length);
			return;
		}
		const value = JSON.parse(strValue);
		const length = JSON.stringify(value).length;
		if (length <= 2*TEXT_SIZE_LIMIT) {
			item.value = value;
		} else {
			item.error = new LrOverflowError(length);
		}
	}

	function lrExtractHeadMeta(array) {
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
		const sizeLimitMap = new Map([
			['description', TEXT_SIZE_LIMIT],
		]);
		/* TODO author
		 * wordpress: body span.author
		 */

		function setProp(node, property, value, key) {
			if (value == null || value === "") {
				return;
			}
			if (property === 'url' || property === 'image') {
				if (value === '#' || value.startsWith('data:') || value.startsWith('javascript:')) {
					console.debug('Ignoring %s %s "%s"', property, key, value);
					return;
				}
				try {
					value = new URL(value, node.baseURI).href;
				} catch (ex) {
					console.debug(
						'Ignoring invalid URL %s %s "%s": %o',
						property, key, value, ex);
					return;
				}
			}
			array.push({ ...lrNormalize(value, sizeLimitMap.get(property)), key, property });
		}

		const head = document.head;
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
					setProp(meta, target, content, 'meta.name.' + name);
				}
			} else if (property) {
				const target = propertyMap.get(property);
				if (target) {
					setProp(meta, target, content, 'meta.property.' + property);
				}
			} else if (itemprop) {
				const target = itempropMap.get(itemprop);
				if (target) {
					setProp(meta, target, content, 'itemprop.' + itemprop);
				}
			}
		}
	}

	try {
		const result = [];
		try {
			lrExtractHeadMeta(result);
		} catch (ex) {
			result.push({ property: "error", key: "lr.meta.head_meta", error: lrToObject(ex) });
		}
		try {
			lrExtractHeadLinks(result);
		} catch (ex) {
			result.push({ property: "error", key: "lr.meta.head_links", error: lrToObject(ex) });
		}
		let item = {
			property: "json_ld",
			key: "document.script",
		};
		try {
			lrExtractLD_JSON(item);
		} catch (ex) {
			item.error = lrToObject(ex);
		}
		if (item.value || item.error) {
			result.push(item);
		}
		return { result };
	} catch (ex) {
		return { error: lrToObject(ex) };
	}
	return { error: "LR internal error: meta.js: should not reach end of the function" };
})();
