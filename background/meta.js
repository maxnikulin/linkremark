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

"use strict";

var lr_meta = lr_util.namespace("lr_meta", lr_meta, function lr_meta() {
	const DEFAILT_SIZE_LIMIT = 1000;
	const TEXT_SIZE_LIMIT = 4000;

	function sanitizeLength(value, error, limit = DEFAILT_SIZE_LIMIT) {
		if (!value || typeof value === "number") {
			return { value, ...(error ? { error } : {}) };
		}
		if (typeof value !== "string") {
			console.warn("lr_meta.sanitizeLength: not a string %o", value);
			value = "" + value;
		}
		if (value.length > limit) {
			return {
				value: value.substring(0, limit),
				error: {
					name: "LrOverflowError",
					size: value.length,
				},
			};
		}
		return { value, ...(error ? { error } : {}) }
	}

	function sanitizeUrl(href, error) {
		if (!href) {
			return { value: href };
		}
		const isURL = href instanceof URL;
		if (isURL) {
			href = href.href;
		}
		if (typeof href !== 'string') {
			return { value: null, error: "TypeError" };
		}
		if (href.startsWith("javascript:")) {
			return { value: "javascript:", error: "LrForbiddenUrlSchema" };
		} else if (href.startsWith("data:")) {
			return { value: "data:", error: "LrForbiddenUrlSchema" };
		}
		const retval = sanitizeLength(href, error);
		if (retval.error) {
			return retval;
		}
		href = retval.value;
		if (!isURL) {
			try {
				href = (new URL(href)).href;
			} catch (ex) {
				console.debug("lr_meta.sanitizeUrl: not an URL: %s %o", href, ex);
				retval.error = "LrNotURL";
			}
		}
		if (href && href.search("#") === href.length - 1) {
			href = href.substring(0, href.length - 1);
		}
		retval.value = href;
		return retval;
	};

	function errorText(error) {
		if (!error) {
			return "";
		}
		const name = typeof error === 'string' ? error : error.name;
		switch (name) {
			case 'LrOverflowError':
				return 'truncated';
				break;
			case 'LrForbiddenUrlSchema':
				return 'URL schema not allowed';
				break;
			default:
				break;
		}
		return "error";
	}

	Object.assign(this, {
		DEFAILT_SIZE_LIMIT, TEXT_SIZE_LIMIT,
		sanitizeLength, sanitizeUrl,
		errorText,
	});
	return this;
});

class LrMetaVariants {
	constructor(variantArray) {
		this.array = variantArray;
		this.valueMap = new Map();
		this.keyMap = new Map();
		for (const variant of variantArray) {
			this.valueMap.set(variant.value, variant);
			for (const key of variant.keys) {
				this.keyMap.set(key, variant);
			}
		}
	};
	set (value, key) {
		// FIXME allow multiple values with the same key
		const keyEntry = this.keyMap.get(key);
		if (keyEntry != null) {
			if (keyEntry.value === value) {
				return;
			}
			const keyIndex = keyEntry.keys.indexOf(key);
			if (keyIndex >= 0) {
				keyEntry.keys.splice(keyIndex, 1);
				if (keyEntry.keys.length === 0) {
					this.valueMap.delete(keyEntry.value);
					this.keyMap.delete(key);
					this.array.splice(this.array.indexOf(keyEntry), 1);
				}
			}
		}
		let valueEntry = this.valueMap.get(value);
		if (valueEntry != null) {
			valueEntry.keys.push(key);
		} else {
			valueEntry = { value, keys: [key] };
			this.array.push(valueEntry);
			this.valueMap.set(value, valueEntry);
		}
		this.keyMap.set(key, valueEntry);
	};
	addDescriptor(descriptor) {
		if (!descriptor) {
			console.warn("LrMetaVariants.addDescriptor: empty argument");
			return false;
		}
		const { key, value, ...attributes } = descriptor;
		// FIXME allow multiple values with the same key
		const keyEntry = this.keyMap.get(key);
		if (keyEntry != null) {
			if (keyEntry.value === value) {
				return;
			}
			const keyIndex = keyEntry.keys.indexOf(key);
			if (keyIndex >= 0) {
				keyEntry.keys.splice(keyIndex, 1);
				if (keyEntry.keys.length === 0) {
					this.valueMap.delete(keyEntry.value);
					this.keyMap.delete(key);
					this.array.splice(this.array.indexOf(keyEntry), 1);
				}
			}
		}
		let valueEntry = this.valueMap.get(value);
		if (valueEntry != null) {
			valueEntry.keys.push(key);
		} else {
			valueEntry = { value, keys: [key] };
			this.array.push(valueEntry);
			this.valueMap.set(value, valueEntry);
		}
		for (const [ attrKey, attrValue ] of Object.entries(attributes)) {
			const currentValue = valueEntry[attrKey];
			if (currentValue !== undefined && currentValue !== attrValue) {
				console.warn("LrMetaVariants.addDescriptor %s attr %s: %o != %o",
					value, attrKey, currentValue, attrValue);
			}
			valueEntry[attrKey] = attrValue;
		}
		this.keyMap.set(key, valueEntry);
	}
	getValueByKey(key) {
		const entry = this.keyMap.get(key);
		return entry && entry.value;
	};
	replace(value, replacement) {
		if (value === replacement) {
			return;
		}
		if (value == null && replacement == null) {
			return;
		}
		if (replacement == null) {
			throw new Error('value for replacement is null');
		}
		if (replacement == null) {
			throw new Error('value is null');
		}
		const entry = this.valueMap.get(value);
		let replacementEntry = this.valueMap.get(replacement);
		if (replacementEntry == null) {
			replacementEntry = {value: replacement, keys: []};
			this.valueMap.set(replacement, replacementEntry);
			this.array[this.array.indexOf(entry)] = replacementEntry;
		}
		for (const key of entry.keys) {
			this.keyMap.set(key, replacementEntry);
			replacementEntry.keys.push(key);
		}
		this.valueMap.delete(value);
	};
	deleteValue(value) {
		const entry = this.valueMap.get(value);
		if (entry == null) {
			return;
		}
		this.valueMap.delete(value);
		for (const key of entry.keys) {
			this.keyMap.delete(key);
		}
		this.array.splice(this.array.indexOf(entry), 1);
	};
	get size() { return this.array.length; };
}

class LrMeta {
	constructor() {
		Object.defineProperty(this, "propertyMap", {
			value: new Map(),
			enumerable: false,
		});
		Object.defineProperty(this, "sanitizerMap", {
			enumerable: false,
			value: new Map(Object.entries({
				url: lr_meta.sanitizeUrl,
				linkUrl: lr_meta.sanitizeUrl,
				srcUrl: lr_meta.sanitizeUrl,
				referrer: lr_meta.sanitizeUrl,
				title: lr_meta.sanitizeLength,
			})),
		});
	};
	set(property, value, key) {
		if (value == null) {
			return false;
		}
		if (!this.propertyMap.has(property)) {
			const array = [];
			this[property] = array;
			this.propertyMap.set(property, new LrMetaVariants(array));
		}
		this.propertyMap.get(property).set(value, "" + key);
		return true;
	};
	addDescriptor(property, descriptor) {
		if (descriptor == null) {
			return false;
		}
		if (!property || typeof property !== "string") {
			console.error("LrMeta.addDescriptor: bad property name: %o %o", property, descriptor);
			return false;
		}
		if (typeof descriptor !== 'object') {
			console.error("LrMeta.addDescriptor: descriptor is not an object: %o %o", property, descriptor);
			return false;
		}
		let { key, value, error, ...other } = descriptor;
		const sanitizer = this.sanitizerMap.get(property) || lr_meta.sanitizeLength;
		const sanitizedResult = sanitizer(value, error);
		if (!key) {
			console.error("LrMeta.addDescriptor: missed key: %o %o", property, descriptor);
			key = "unspecified." + property;
		}
		let variants = this.propertyMap.get(property);
		if (!variants) {
			const array = [];
			this[property] = array;
			variants = new LrMetaVariants(array);
			this.propertyMap.set(property, variants);
		}
		// Value is added only if sanitizer set it
		variants.addDescriptor({...other, error, ...sanitizedResult, key});
		return true;
	}

	get(property, key=null) {
		const variants = this.propertyMap.get(property);
		if (variants == null || key == null) {
			return variants && variants.array;
		}
		return variants.getValueByKey(key);
	};
	getAnyValue(property) {
		const variants = this.propertyMap.get(property);
		return variants && variants.array && variants.array[0] &&
			variants.array[0].value;
	};
	replace(property, value, replacement) {
		const variants = this.propertyMap.get(property);
		variants.replace(value, replacement);
	};
	deleteValue(property, value) {
		const variants = this.propertyMap.get(property);
		variants.deleteValue(value);
		if (!(variants.size > 0)) {
			this.propertyMap.delete(property);
			delete this[property];
		}
	};
};

lr_meta.normalizeUrl = function(href) {
	if (!href) {
		return href;
	} else if (href.startsWith("javascript:")) {
		return "javascript:";
	} else if (href.startsWith("data:")) {
		return "data:";
	} else if (href.search("#") === href.length - 1) {
		return href.substring(0, href.length - 1);
	}
	return href;
};

lr_meta.copyProperty = function(value, metaMap, property, key) {
	if (value == null || value === "") {
		return;
	}
	metaMap.set(property, value, key);
};

lr_meta.mergeTab = function(frameInfo, meta) {
	const tab = frameInfo.tab;
	if (tab == null) {
		return;
	}
	lr_meta.copyProperty(lr_meta.normalizeUrl(tab.url), meta, "url", "tab.url");
	lr_meta.copyProperty(tab.title, meta, "title", "tab.title");
	lr_meta.copyProperty(lr_meta.normalizeUrl(tab.favIconUrl), meta, "favicon", "tab.favicon");
};

lr_meta.mergeFrame = function(frameInfo, meta) {
	if (frameInfo.frame && !frameInfo.frame.synthetic) {
		lr_meta.copyProperty(lr_meta.normalizeUrl(frameInfo.frame.url), meta, "url", "frame.url");
	}
};

lr_meta.mergeContent = function(frameInfo, meta) {
	const content = frameInfo.content && frameInfo.content.result;
	if (content == null) {
		return;
	}
	lr_meta.copyProperty(lr_meta.normalizeUrl(content.url), meta, "url", "window.location");
	lr_meta.copyProperty(content.title, meta, "title", "document.title");
	lr_meta.copyProperty(content.body, meta, "selection", "window.getSelection");
}

lr_meta.mergeClickData = function(frameInfo, meta) {
	const clickData = frameInfo.clickData;
	if (clickData == null) {
		return;
	}
	lr_meta.copyProperty(
		clickData.selectionText && [ clickData.selectionText ],
		meta, "selection", "clickData.selectionText");
	lr_meta.copyProperty(clickData.linkText, meta, "linkText", "clickData.linkText");
	lr_meta.copyProperty(lr_meta.normalizeUrl(clickData.linkUrl), meta, "linkUrl", "clickData.linkUrl");
	lr_meta.copyProperty(lr_meta.normalizeUrl(clickData.frameUrl), meta, "url", "clickData.frameUrl");
	if (frameInfo.frame.frameId === 0) {
		lr_meta.copyProperty(lr_meta.normalizeUrl(clickData.pageUrl), meta, "url", "clickData.pageUrl");
	}
	lr_meta.copyProperty(clickData.mediaType, meta, "mediaType", "clickData.mediaType");
	lr_meta.copyProperty(
		lr_meta.normalizeUrl(clickData.srcUrl),
		meta,
		clickData.captureObject === "frame" || clickData.captureObject === "link" ? "url" : "srcUrl",
		"clickData.srcUrl");
	if (clickData.captureObject) {
		meta.target = clickData.captureObject;
	}
};

lr_meta.mergeRelations = function(frameInfo, meta) {
	const relations = frameInfo && frameInfo.referrer && frameInfo.referrer.result;
	if (relations == null) {
		return;
	}
	const referrerKeys = new Set([
		'document.referrer',
		'window.opener',
		'window.parent',
		'window.top',
	]);
	for (const descriptor of relations) {
		if (referrerKeys.has(descriptor.key)) {
			meta.addDescriptor('referrer', descriptor);
		} else if (descriptor.key === 'document.lastModified') {
			meta.addDescriptor('lastModified', descriptor);
		}
	}
};

lr_meta.mergeLink = function(frameInfo, meta) {
	const link = frameInfo.link && frameInfo.link.result;
	if (link == null) {
		return;
	}
	lr_meta.copyProperty(lr_meta.normalizeUrl(link.href), meta, "linkUrl", "link.href");
	lr_meta.copyProperty(link.text, meta, "linkText", "link.text");
	lr_meta.copyProperty(link.title, meta, "linkTitle", "link.title");
	lr_meta.copyProperty(link.type, meta, "linkType", "link.type");
	lr_meta.copyProperty(link.download, meta, "linkDownload", "link.download");
	lr_meta.copyProperty(link.hreflang, meta, "linkHreflang", "link.hreflang");
};

lr_meta.mergeImage = function(frameInfo, meta) {
	const image = frameInfo.image && frameInfo.image.result;
	if (image == null) {
		return;
	}
	lr_meta.copyProperty(lr_meta.normalizeUrl(image.src), meta, "srcUrl", "image.src");
	lr_meta.copyProperty(image.alt, meta, "imageAlt", "image.alt");
	lr_meta.copyProperty(image.title, meta, "imageTitle", "image.title");
};

lr_meta.mergeHead = function(frameInfo, meta) {
	const head = frameInfo && frameInfo.meta && frameInfo.meta.result
		&& frameInfo.meta.result.head && frameInfo.meta.result.head.result || null;
	if (!head) {
		return meta;
	}
	for (const [ field, descriptorArray ] of Object.entries(head)) {
		for (const descriptor of descriptorArray) {
			for (const key of descriptor.keys || [`unspecified.${field}`]) {
				lr_meta.copyProperty(descriptor.value, meta, field, key);
			}
		}
	}
	return meta;
}

lr_meta.merge = function(frameInfo) {
	const meta = new LrMeta();
	if (!frameInfo) {
		return meta;
	}

	const mergeMethods = [
		this.mergeHead,
		this.mergeTab,
		this.mergeFrame,
		this.mergeContent,
		this.mergeClickData,
		this.mergeRelations,
		this.mergeLdJson,
		this.mergeImage,
		this.mergeLink,
	];
	for (const method of mergeMethods) {
		try {
			method.call(this, frameInfo, meta)
		} catch (ex) {
			console.error(`lr_meta.merge: ${method.name}: continue despite exception`, ex);
		}
	}

	const cleanupMethods = [
		this.decodeDescription,
		this.removeDescriptionDuplicate,
		this.removeTextLinkDuplicate,
		this.removeNonCanonicalSlash,
	];
	for (const method of cleanupMethods) {
		try {
			method.call(this, meta)
		} catch (ex) {
			console.error(`lr_meta.merge: ${method.name}: continue despite exception`, ex);
		}
	}

	return meta;
};

lr_meta.removeDescriptionDuplicate = function(metaMap) {
	const titleSet = new Set((metaMap.get('title') || []).map(entry => entry.value));
	if (!(titleSet.size > 0)) {
		return
	}
	const descriptionVariants = (metaMap.get('description') || []).slice();
	for (let description of descriptionVariants) {
		if (titleSet.has(description.value)) {
			console.debug("LR clean meta: remove description similar to title %o", description);
			metaMap.deleteValue('description', description.value);
			for (const key of description.keys) {
				lr_meta.copyProperty(description.value, metaMap, 'title', key);
			}
		}
	}
};

lr_meta.removeTextLinkDuplicate = function(metaMap) {
	const linkUrlSet = new Set((metaMap.get('linkUrl') || []).map(entry => entry.value));
	if (!(linkUrlSet.size > 0)) {
		return;
	}
	const linkTextVariants = (metaMap.get('linkText') || []).slice();
	for (const entry of linkTextVariants) {
		if (linkUrlSet.has(entry.value)) {
			console.debug("LR clean meta: remove linkText similar to linkUrl %o", entry);
			metaMap.deleteValue('linkText', entry.value);
			for (const key of entry.keys) {
				lr_meta.copyProperty(entry.value, metaMap, 'linkUrl', key);
			}
		}
	}
};

/* github og:description has entity-encoded apostrophes and twitter:description
 * has double encoded apostrophes. Maybe it is done to allow verbatim paste into html.
 * Since longer description is preferred, strings should be decoded prior to length comparison.
 */
lr_meta.decodeDescription = function(metaMap) {
	const twitter = metaMap.get('description', 'meta.name.twitter:description') ||
		metaMap.get('description', 'meta.property.twitter:description');
	if (twitter) {
		metaMap.replace('description', twitter, lr_meta.unescapeEntities(lr_meta.unescapeEntities(twitter)));
	}
	const og = metaMap.get('description', 'meta.name.og:description') ||
		metaMap.get('description', 'meta.property.og:description');
	if (og) {
		metaMap.replace('description', og, lr_meta.unescapeEntities(og));
	}
}

lr_meta.removeNonCanonicalSlash = function(meta) {
	const canonical = meta.get("url", "link.canonical");
	if (!canonical) {
		return;
	}
	const toRemove = canonical.endsWith("/") ? canonical.replace(/\/$/, "") : canonical + "/";
	meta.deleteValue("url", toRemove);
};

lr_meta.mergeLdJson = function(frameInfo, meta) {
	const json = frameInfo.meta && frameInfo.meta.result &&
		frameInfo.meta.result.ld_json && frameInfo.meta.result.ld_json.result;
	if (json == null) {
		return;
	}
	return lr_json_ld.mergeJsonLd(json, meta);
};

lr_meta.html_entity_string = Object.assign(Object.create(null), {
	amp: "&",
	quot: '"',
	apos: "'",
	gt: ">",
	lt: "<",
	laquo: "»",
	raquo: "»",
});

lr_meta.htmlEntityReplaceCb = function(match, p1) {
	if (p1[0] === '#') {
		try {
			if (p1[1] === 'x' || p1[1] === 'X') {
				return lr_meta.getHtmlCharByCode(parseInt(p1.substr(2), 16));
			} else {
				return lr_meta.getHtmlCharByCode(parseInt(p1.substr(1), 10));
			}
		} catch(ex) {
			console.error('lr_meta.htmlEntityReplaceCb', 'match', ex);
		}
	}
	return lr_meta.html_entity_string[p1] || match;
};

lr_meta.unescapeEntities = function(str) {
	if (!str) {
		return str;
	}
	return str.replace(/&([a-zA-Z]+|#[xX]?[0-9]+);/g, lr_meta.htmlEntityReplaceCb);
};

/**
 * https://html.spec.whatwg.org/multipage/parsing.html#table-charref-overrides
 */
lr_meta.getHtmlCharByCode = function(code) {
	const replacement = 0xFFFD; /* REPLACEMENT CHARACTER */
	if (code > 0x10FFFF || code === 0x00 || code === 0x0D) {
		code = replacement;
	} else if (code >= 0x80 && code <= 0x9F) {
		const values = [
			/* 0x80 */ 0x20AC /* EURO SIGN (€) */,
			0x81,
			/* 0x82 */ 0x201A /* SINGLE LOW-9 QUOTATION MARK (‚) */,
			/* 0x83 */ 0x0192 /* LATIN SMALL LETTER F WITH HOOK (ƒ) */,
			/* 0x84 */ 0x201E /* DOUBLE LOW-9 QUOTATION MARK („) */,
			/* 0x85 */ 0x2026 /* HORIZONTAL ELLIPSIS (…) */,
			/* 0x86 */ 0x2020 /* DAGGER (†) */,
			/* 0x87 */ 0x2021 /* DOUBLE DAGGER (‡) */,
			/* 0x88 */ 0x02C6 /* MODIFIER LETTER CIRCUMFLEX ACCENT (ˆ) */,
			/* 0x89 */ 0x2030 /* PER MILLE SIGN (‰) */,
			/* 0x8A */ 0x0160 /* LATIN CAPITAL LETTER S WITH CARON (Š) */,
			/* 0x8B */ 0x2039 /* SINGLE LEFT-POINTING ANGLE QUOTATION MARK (‹) */,
			/* 0x8C */ 0x0152 /* LATIN CAPITAL LIGATURE OE (Œ) */,
			0x8D,
			/* 0x8E */ 0x017D /* LATIN CAPITAL LETTER Z WITH CARON (Ž) */,
			0x8F,
			0x90,
			/* 0x91 */ 0x2018 /* LEFT SINGLE QUOTATION MARK (‘) */,
			/* 0x92 */ 0x2019 /* RIGHT SINGLE QUOTATION MARK (’) */,
			/* 0x93 */ 0x201C /* LEFT DOUBLE QUOTATION MARK (“) */,
			/* 0x94 */ 0x201D /* RIGHT DOUBLE QUOTATION MARK (”) */,
			/* 0x95 */ 0x2022 /* BULLET (•) */,
			/* 0x96 */ 0x2013 /* EN DASH (–) */,
			/* 0x97 */ 0x2014 /* EM DASH (—) */,
			/* 0x98 */ 0x02DC /* SMALL TILDE (˜) */,
			/* 0x99 */ 0x2122 /* TRADE MARK SIGN (™) */,
			/* 0x9A */ 0x0161 /* LATIN SMALL LETTER S WITH CARON (š) */,
			/* 0x9B */ 0x203A /* SINGLE RIGHT-POINTING ANGLE QUOTATION MARK (›) */,
			/* 0x9C */ 0x0153 /* LATIN SMALL LIGATURE OE (œ) */,
			0x9D,
			/* 0x9E */ 0x017E /* LATIN SMALL LETTER Z WITH CARON (ž) */,
			/* 0x9F */ 0x0178 /* LATIN CAPITAL LETTER Y WITH DIAERESIS (Ÿ)  */,
		];
		code = values[code - 0x80];
	}
	return String.fromCodePoint(code);
}
