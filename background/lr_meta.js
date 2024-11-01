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

"use strict";

var lr_meta = lr_util.namespace(lr_meta, function lr_meta() {
	var lr_meta = this;
	const STRING_SIZE_LIMIT = 1000;
	const limits = lr_meta.limits = {
		STRING: STRING_SIZE_LIMIT,
		TEXT: 4*STRING_SIZE_LIMIT,
		JSON: 4*8*STRING_SIZE_LIMIT,
		SELECTION_FRAGMENT_COUNT: 128,
		JSON_FRAGMENT_COUNT: 4,
		MICRODATA_PROPERTY_COUNT: 16,
		MICRODATA_OTHER_COUNT: 16,
		MICRODATA_TOTAL_COUNT: 1024,
	};
	// selection, 10x10 table
	console.assert(limits.TEXT >= limits.STRING, "Text and string length limits should be consistent");
	console.assert(limits.JSON >= limits.TEXT, "JSON and text length limits should be consistent");
	this.DOI_Prefixes = {
		// canonical resolvers
		"dx.doi.org": { prefix: "", url: false },
		"doi.org": { prefix: "", url: false },
		"www.doi.org": { prefix: "", url: false },
		"doi.pangaea.de": { prefix: "", url: false },
		"hdl.handle.net": { prefix: "", url: false },
		// URL of paywall alternatives may have value in addition to doi.
		"oadoi.org": { prefix: "", url: true },
		"doai.io": { prefix: "", url: true },
		"dissem.in": { prefix: "/api", url: true },
		// Some publishers
		"science.org": { prefix: "/doi", url: true },
		"www.science.org": { prefix: "/doi", url: true },
		"pubs.acs.org": { prefix: "/doi", url: true },
	};
	this.reDOI_Key = /\.(?:citation_)?doi$/i;

	function *errorsLast(descriptorIterable) {
		yield* lr_iter.stableSort(
			descriptorIterable, (a, b) => !!a.error - !!b.error);
	}

	function firstValue(...iterableArgs) {
		for (const descriptor of errorsLast(lr_iter.combine(...iterableArgs))) {
			if (descriptor.value != null) {
				return descriptor.value;
			}
		}
	}

	function firstText(...iterableArgs) {
		let descriptor;
		for (const d of errorsLast(lr_iter.combine(...iterableArgs))) {
			if (d.value) {
				descriptor = d;
				break;
			} else {
				descriptor = descriptor || d;
			}
		}
		if (!descriptor) {
			return null;
		}
		const components = [];
		// TODO attributes?
		if (descriptor.value != null) {
			components.push(String(descriptor.value));
		}
		if (descriptor.error) {
			const text = errorText(descriptor.error);
			if (text) {
				components.push("(!)", text);
			}
		}
		if (components.length > 0) {
			return components.join(" ");
		}
		return null;
	}

	function* validUrls(...iterableDescriptors) {
		for (const descriptor of lr_iter.combine(...iterableDescriptors)) {
			if (descriptor.error != null) {
				continue;
			}
			const value = descriptor.value;
			if (value == null) {
				console.warn("lr_meta.validUrls: descriptor has neither value nor error: %o", descriptor);
			} else if (typeof value === "string") {
				yield value;
			} else if (value instanceof URL) {
				yield value.href;
			} else {
				console.warn("lr_meta.validUrls: unsupported value type: %o", descriptor);
			}
		}
	}

	function testKey(descriptor, regexp) {
		try {
			const { key, keys } = descriptor;
			if (typeof key === "string") {
				if (regexp.test(key)) {
					return true;
				}
			}
			if (!keys) {
				return false;
			}
			return keys.some(k => regexp.test(k));
		} catch (ex) {
			console.error(
				"lr_meta.testKey: internal error: %o, arguments: %o, %o",
				ex, descriptor, regexp);
		}
		return false;
	}

	function doSanitizeLength(valueError, limit = limits.STRING) {
		let { value, ...error } = valueError;
		const t = typeof value;
		if (value == null || t === "number" || t === "boolean") {
			return valueError;
		}
		if (typeof value !== "string") {
			console.warn("lr_meta.sanitizeLength: not a string %o", value);
			value = String(value);
		}
		// It fixes indirectly problem with stray leading "\ufeff" Byte Order Mark
		// that is considered by space but was replaced by "\ufffd" Replacement
		// Character only after formatting.
		value = value.trim();
		// For Org formatter result will be passed through the same filter.
		// As a safety measure do it hear since user may choose JSON object.
		value = lr_util.replaceSpecial(value);
		if (!(value.length <= limit)) {
			return {
				value: value.substring(0, limit),
				...error,
				error: {
					name: "LrOverflowError",
					size: value.length,
				},
			};
		}
		return { value, ...error }
	}

	function* sanitizeLength(valueError, limit) {
		yield doSanitizeLength(valueError, limit);
	}

	/// Actually a generator
	function sanitizeText(valueError, limit = limits.TEXT) {
		return sanitizeLength(valueError, limit);
	}

	/** Check if URL matches known DOI schemes or resolvers.
	 *
	 * Argument is a URL property descriptor.
	 * Returns:
	 * - `null` if no DOI is recognized,
	 * - `[ DOI_PropertyDescriptor ]` if original URL should be ignored,
	 * - `[ descriptor, DOI_PropertyDescriptor ]` if both original
	 *   value and DOI may be useful.
	 *
	 * The intention is to allow other URL heuristics.
	 */
	function matchDOI(descriptor) {
		let { value, error } = descriptor;
		const notDOI = null;
		const isURL = value instanceof URL;
		if (error || !(isURL || typeof value === "string")) {
			return notDOI;
		}

		function toDOI(id, keepURL) {
			if (!id) {
				return notDOI;
			}
			const doi = { ...descriptor, value: "doi:" + id };
			Object.defineProperty(doi, "_urlSanitized", {
				// Keep it within background scirpt only.
				enumerable: false,
				configurable: true,
				value: true,
			});
			return keepURL ? [ descriptor, doi ] : [ doi ];
		}

		const isDOI_key = testKey(descriptor, lr_meta.reDOI_Key);
		if (!isURL) {
			if (isDOI_key && value.startsWith("10.")) {
				return toDOI(value, false);
			}
			try {
				value = new URL(value);
			} catch (ex) {
				console.debug("lr_meta.matchDOI: error: ignored: %o", ex);
				return notDOI;
			}
		}

		// https://en.wikipedia.org/wiki/Digital_object_identifier#Resolution
		// strip search (query) and fragment
		if (value.protocol === "doi:" || value.protocol === "hdl:") {
			value = value.hostname + value.pathname;
			return toDOI(value, false);
		}
		if (value.protocol === "info:") {
			const reInfoSchema = /^(?:doi|hdl)\//i;
			const cleaned = value.pathname.replace(reInfoSchema, "");
			return value.pathname === cleaned ? notDOI : toDOI(cleaned, false);
		}
		if (value.protocol !== "https:" && value.protocol !== "http:") {
			return notDOI;
		}
		const strip = lr_meta.DOI_Prefixes[value.hostname];
		if (strip === undefined) {
			if (!isDOI_key) {
				return notDOI;
			}
			for (const prefix of ["/doi", ""]) {
				if (value.pathname.startsWith(prefix + "/10.")) {
					return toDOI(value.pathname.substring(prefix.length + 1), true);
				}
			}
			return notDOI;
		}
		const prefix = strip.prefix + "/10.";
		if (!value.pathname.startsWith(prefix)) {
			return notDOI;
		}
		return toDOI(value.pathname.substring(strip.prefix.length + 1), strip.url);
	}

	function doSanitizeUrl(valueError) {
		let { value, ...error } = valueError;
		const isURL = value instanceof URL;
		if (isURL) {
			value = value.href;
		}
		if (typeof value !== 'string') {
			return { value: null, error: "TypeError", ...error };
		}
		if (value.startsWith("javascript:")) {
			return { value: "javascript:", ...error, error: "LrForbiddenUrlSchema" };
		} else if (value.startsWith("data:")) {
			return { value: "data:", ...error, error: "LrForbiddenUrlSchema" };
		}
		const retval = doSanitizeLength({value, ...error});
		if (retval.error) {
			return retval;
		}
		value = retval.value;
		try {
			if (!isURL) {
				value = (new URL(value)).href;
			}
			if (value && value[value.length - 1] === "#") {
				value = value.substring(0, value.length - 1);
			}
		} catch (ex) {
			console.debug("lr_meta.sanitizeUrl: not an URL: %s %o", value, ex);
			retval.error = "LrNotURL";
		}
		retval.value = value;
		return retval;
	}

	function* sanitizeUrl(valueAndError) {
		// TODO strip `view-source:` prefix (Firefox).
		// TODO strip `view-source:` equivalent for Chromium.
		delete valueAndError._urlSanitized;
		valueAndError = doSanitizeLength(valueAndError);
		let doiVariants;
		try {
			doiVariants = lr_meta.matchDOI(valueAndError);
		} catch (ex) {
			console.error("lr_meta.sanitizeUrl: matchDOI failed: %o", ex);
		}
		if (!doiVariants) {
			doiVariants = [ valueAndError ];
		}
		for (let variant of doiVariants) {
			try {
				if (!variant._urlSanitized) {
					// It can not be done prior to DOI detection since
					// `<meta name="doi" content="10.1.1.1">`
					// gives a value that is not valid `URL`.
					variant = doSanitizeUrl(variant);
					Object.defineProperty(variant, "_urlSanitized", {
						// Keep it within background scirpt only.
						enumerable: false,
						configurable: true,
						value: true,
					});
				}
				yield variant;
			} catch (ex) {
				console.error("lr_meta.sanitizeUrl: error: %o %o", ex, variant);
			}
		}
	}

	function* sanitizeTextOrArray(valueError) {
		const { value, ...arrayError } = valueError;
		const fragmentArray = value;
		if (!Array.isArray(fragmentArray)) {
			if (typeof value === 'string') {
				yield* sanitizeText(valueError);
			} else {
				yield { value: [], error: "TypeError", ...arrayError };
			}
			return;
		}
		const result = [];
		let available = limits.TEXT;
		let error = arrayError;

		function reduceError(current, update) {
			if (current.error || !update) {
				return current;
			}
			return { ...current, error: update }
		}

		for (const fragment of fragmentArray) {
			if (!(result.length < limits.SELECTION_FRAGMENT_COUNT)) {
				error = reduceError(error, { name: "LrOverflowError", size: fragmentArray.length });
				break;
			}
			if (!fragment) {
				result.push({ value: "", error: "TypeError" });
				error = reduceError(error, "TypeError");
				continue;
			}
			error = reduceError(error, fragment.error);
			const value = fragment.value;
			if (!value) {
				result.push(fragment);
				continue;
			} else if (typeof value !== "string") {
				result.push({ error: "TypeError", ...fragment, value: "" });
				error = reduceError(error, "TypeError");
				continue;
			}
			if (value.length <= available) {
				result.push(fragment);
				available -= value.length;
				continue;
			}
			if (available < limits.STRING) {
				const err = { name: "LrOverflowError", size: value.length };
				result.push({ value: "", error: err });
				error = reduceError(error, err);
				break;
			}
			const sanitized = doSanitizeLength(fragment, available);
			result.push(sanitized);
			error = reduceError(error, sanitized.error);
		}
		yield { value: result, ...error };
	}

	function* sanitizeObject(valueError) {
		const { value, ...error } = valueError;
		try {
			const length = JSON.stringify(value).length;
			if (!(length < 2*limits.TEXT)) {
				yield { ...error, error: {
					name: "LrOverflowError",
					size: value.length,
				} };
				return;
			}
			yield { value, ...error };
		} catch (ex) {
			yield { ...error, error: lr_util.errorToObject(ex) };
		}
	}

	function *sanitizeSchemaOrg(valueError) {
		const { value, ...other } = valueError;
		if (typeof value === "string") {
			const { value, ...other } = doSanitizeLength(valueError, limits.JSON);
			if (other.error != null) {
				yield other;
				return;
			}
			try {
				const obj = JSON.parse(lr_meta.unescapeEntities(value, { json: true }));
				yield { ...other, value: obj };
			} catch (ex) {
				if (ex instanceof SyntaxError) {
					yield { ...other, error: lr_util.errorToObject(ex) }
				} else {
					throw ex;
				}
			}
			return;
		} else if (value !== null && typeof value === 'object' ) {
			yield *sanitizeObject(valueError);
		} else {
			yield { error: "TypeError", ...other };
		}
	}

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

	function objectToMeta(obj) {
		if (!obj) {
			return obj;
		}
		if (obj._type) {
			const elements = obj.elements;
			if (!elements) {
				return obj;
			}
			for (let i = 0; i < elements.length; ++i) {
				elements[i] = objectToMeta(elements[i]);
			}
			return obj;
		}
		const meta = new LrMeta();
		for (const [ property, variants ] of Object.entries(obj)) {
			for (const v of variants) {
				meta.addDescriptor(property, v);
			}
		}
		return meta;
	}

	Object.assign(this, {
		testKey,
		doSanitizeLength, matchDOI, doSanitizeUrl,
		sanitizeLength, sanitizeText, sanitizeUrl,
		sanitizeObject,
		sanitizeTextOrArray,
		sanitizeSchemaOrg,
		errorText,
		objectToMeta,
		errorsLast,
		firstText,
		firstValue,
		validUrls,
	});
	return this;
});

class LrMetaVariants {
	constructor(variantArray) {
		this.array = variantArray;
		this.valueMap = new Map();
		this.keyMap = new lr_multimap.LrMultiMap();
		for (const variant of variantArray) {
			this.valueMap.set(variant.value, variant);
			console.assert(!("key" in variant), "Descriptors passed to LrMetaVariants should not have 'key' property");
			for (const key of variant.keys) {
				this.keyMap.set(key, variant);
			}
		}
	};
	set (value, key) {
		let valueEntry = this.valueMap.get(value);
		if (valueEntry != null) {
			if (!this.keyMap.has(key, valueEntry)) {
				valueEntry.keys.push(key);
			}
		} else {
			valueEntry = { value, keys: [key] };
			this.array.push(valueEntry);
			this.valueMap.set(value, valueEntry);
		}
		this.keyMap.set(key, valueEntry);
	};
	*descriptors(key = undefined) {
		if (key === undefined) {
			yield* this.array || [];
		} else {
			yield* this.keyMap.values(key);
		}
	}
	addDescriptor(descriptor) {
		if (!descriptor) {
			console.warn("LrMetaVariants.addDescriptor: empty argument");
			return false;
		}
		const { key, keys, value, ...attributes } = descriptor;
		const keyVariants = keys || [];
		if (key) {
			keyVariants.push(key);
		}
		if (!(keyVariants.length > 0)) {
			console.error("LrMetaVariants: no keys %s", keyVariants);
			return false;
		}
		let valueEntry = this.valueMap.get(value);
		if (valueEntry == null) {
			valueEntry = { value, keys: [] };
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

		for (const keyItem of keyVariants) {
			if (this.keyMap.has(keyItem, valueEntry)) {
				continue;
			}
			valueEntry.keys.push(keyItem);
			this.keyMap.set(keyItem, valueEntry);
		}
		return true;
	}
	// FIXME remove
	getValueByKey(key) {
		for (const descriptor of this.keyMap.values(key)) {
			return descriptor && descriptor.value;
		}
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
		if (value == null) {
			throw new Error('value is null');
		}
		const entry = this.valueMap.get(value);
		if (entry == null) {
			console.error("LrMetaVariants.replace: no entry for value '%o'", value);
			throw new Error("Unknown value");
		}
		let replacementEntry = this.valueMap.get(replacement);
		if (replacementEntry == null) {
			replacementEntry = { ...entry, value: replacement, keys: [] };
			this.valueMap.set(replacement, replacementEntry);
			this.array[this.array.indexOf(entry)] = replacementEntry;
		}
		for (const key of entry.keys) {
			this.keyMap.delete(key, entry); 
			this.keyMap.set(key, replacementEntry);
		}
		replacementEntry.keys.push(...entry.keys);
		this.valueMap.delete(value);
	};
	deleteValue(value) {
		const entry = this.valueMap.get(value);
		if (entry == null) {
			return;
		}
		this.valueMap.delete(value);
		for (const key of entry.keys) {
			this.keyMap.delete(key, value);
		}
		this.array.splice(this.array.indexOf(entry), 1);
		return true;
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
				image: lr_meta.sanitizeUrl,
				linkUrl: lr_meta.sanitizeUrl,
				srcUrl: lr_meta.sanitizeUrl,
				referrer: lr_meta.sanitizeUrl,
				favicon: lr_meta.sanitizeUrl,
				tabGroupTitle: lr_meta.sanitizeLength,
				title: lr_meta.sanitizeLength,
				linkText: lr_meta.sanitizeText,
				selection: lr_meta.sanitizeTextOrArray,
				schema_org: lr_meta.sanitizeSchemaOrg,
				error: lr_meta.sanitizeObject,
				offer: lr_meta.sanitizeObject, // TODO consider a special map for Product
			})),
		});
	};
	// It does not pass value through sanitizer
	set(property, value, key) {
		console.error("LrMeta.set is deprecated %o %o %o", property, key, value);
		if (value == null) {
			return false;
		}
		this.ensureVariants(property).set(value, "" + key);
		return true;
	};
	*descriptors(property, key = undefined) {
		if (property == null) {
			console.error("LrMeta.descriptors(%o, %o): no property specified", property, key);
			return;
		}
		const variants = this.propertyMap.get(property);
		if (variants !== undefined) {
			yield* variants.descriptors(key);
		}
	}
	addDescriptor(property, descriptor, params) {
		try {
			return this.doAddDescriptor(property, descriptor, params);
		} catch (ex) { // FIXME pass to executor
			console.error("lr_meta.addDescriptor: %o %o %o", property, ex, descriptor);
		}
		return false;
	};
	doAddDescriptor(property, descriptor, params) {
		const { skipEmpty } = params || {};
		if (descriptor == null) {
			if (skipEmpty) {
				return false;
			}
			throw new Error("Meta descriptor is null");
		}
		if (skipEmpty && (descriptor.value == null || descriptor.value == "") && !descriptor.error) {
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
		let { key, keys } = descriptor;
		if (!key && !keys) {
			console.error("LrMeta.addDescriptor: missed key: %o %o", property, descriptor);
			descriptor.key = "unspecified." + property;
		}
		const variants = this.ensureVariants(property);
		const sanitizer = this.sanitizerMap.get(property) || lr_meta.sanitizeLength;
		for (const sanitizedResult of sanitizer(descriptor)) {
			variants.addDescriptor(sanitizedResult);
		}
		return true;
	}

	ensureVariants(property) {
		let variants = this.propertyMap.get(property);
		if (!variants) {
			const array = [];
			this[property] = array;
			variants = new LrMetaVariants(array);
			this.propertyMap.set(property, variants);
		}
		return variants;
	}

	move(descriptor, fromProperty, toProperty) {
		const argErrors = [];
		if (!fromProperty || typeof fromProperty !== "string") {
			argErrors.push("fromProperty not a string or empty");
		}
		if (!toProperty || typeof toProperty !== "string") {
			argErrors.push("toProperty not a string or empty");
		}
		if (!descriptor || typeof descriptor !== "object") {
			argErrors.push("descriptor is not an object or empty");
		}
		if (argErrors.length !== 0) {
			console.error(
				"LrMeta.move(%o, %o, %o): %o",
				descriptor, fromProperty, toProperty, argErrors);
			return false;
		}
		const deleted = this.deleteValue(fromProperty, descriptor.value);
		const sanitizer = this.sanitizerMap.get(toProperty);
		if (!deleted || this.sanitizerMap.get(fromProperty) !== sanitizer) {
			const message = deleted ? "source and target sanitizers differ"
				: "no descriptor in fromProperty";
			console.warn("LrMeta.move: %s: %o %o", message, fromProperty, toProperty);
			return this.addDescriptor(toProperty, descriptor);
		}
		return this.ensureVariants(toProperty).addDescriptor(descriptor);
	}

	get(property, key=null) {
		const variants = this.propertyMap.get(property);
		if (variants == null || key == null) {
			return variants && variants.array;
		}
		return variants.getValueByKey(key);
	};
	replace(property, value, replacement) {
		const variants = this.propertyMap.get(property);
		variants.replace(value, replacement);
	};
	deleteValue(property, value) {
		const variants = this.propertyMap.get(property);
		if (!variants) {
			return false;
		}
		const retval = !!variants.deleteValue(value);
		if (!(variants.size > 0)) {
			this.propertyMap.delete(property);
			delete this[property];
		}
		return retval;
	};
};

lr_meta.mergeTab = function(frameInfo, meta) {
	const tab = frameInfo.tab;
	if (tab == null) {
		return;
	}
	meta.addDescriptor("url", { value: tab.url, key: "tab.url" }, { skipEmpty: true });
	meta.addDescriptor("title", { value: tab.title, key: "tab.title" }, { skipEmpty: true });
	meta.addDescriptor("favicon", { value: tab.favIconUrl, key: "tab.favicon" }, { skipEmpty: true });
	meta.addDescriptor("tabGroupTitle", { value: tab.groupTitle, key: "tab.groupTitle" }, { skipEmpty: true });
};

lr_meta.mergeFrame = function(frameInfo, meta) {
	if (frameInfo.frame && !frameInfo.frame.synthetic) {
		meta.addDescriptor("url", { value: frameInfo.frame.url, key: "frame.url" }, { skipEmpty: true });
	}
};

lr_meta.mergeClickData = function(frameInfo, meta) {
	const clickData = frameInfo.clickData;
	if (clickData == null) {
		return;
	}
	const skip = { skipEmpty: true }
	meta.addDescriptor(
		"selection",
		{ value: clickData.selectionText, key: "clickData.selectionText" },
		skip
	);
	meta.addDescriptor("linkText", { value: clickData.linkText, key: "clickData.linkText" }, skip);
	meta.addDescriptor("linkUrl", { value: clickData.linkUrl, key: "clickData.linkUrl" }, skip);
	meta.addDescriptor("url", { value: clickData.frameUrl, key: "clickData.frameUrl" }, skip);
	if (frameInfo.frame.frameId === 0) {
		meta.addDescriptor("url", { value: clickData.pageUrl, key: "clickData.pageUrl" }, skip);
	}
	meta.addDescriptor("mediaType", { value: clickData.mediaType, key: "clickData.mediaType" }, skip);
	meta.addDescriptor(
		clickData.captureObject === "frame" || clickData.captureObject === "link" ? "url" : "srcUrl",
		{ value: clickData.srcUrl, key: "clickData.srcUrl" },
		skip
	);
	if (clickData.captureObject) {
		meta.addDescriptor("target", {
			value: clickData.captureObject,
			key: "clickData.captureObject",
		});
	}
};

lr_meta.mergeContentScript = function (frameInfo, field, meta) {
	try {
		// TODO limit length of all attributes
		const scriptValue = frameInfo[field];
		if (scriptValue == null) {
			return;
		}
		const error = scriptValue.error;
		if (error) {
			meta.addDescriptor("error", { value: error,  key: `content_script.${field}` });
		}
		const result = scriptValue.result;
		if (result != null) {
			for (const entry of result) {
				const { property, ...descriptor } = entry;
				if (!property || typeof property !== 'string') {
					console.warn("lr_meta: unspecified property from %o: %o", field, entry);
					meta.addDescriptor("error", { value: "Unspecified property", key: `content_script.${field}` });
					return;
				}
				meta.addDescriptor(property, descriptor);
			}
		}
	} catch (ex) {
		meta.addDescriptor("error", { value: lr_util.errorToObject(ex), key: `content_script.${field}` });
	}
}

lr_meta.merge = function(frameInfo) {
	const meta = new LrMeta();
	if (!frameInfo) {
		return meta;
	}

	if (frameInfo.summary && frameInfo.summary.scripts_forbidden) {
		meta.addDescriptor("error", {
			value: { message: "Content scripts are forbidden in a privileged frame" },
			key: "content_script"
		});
	} else {
		for (const field of [ "relations", "meta", "selection", "image", "link", "microdata" ]) {
			lr_meta.mergeContentScript(frameInfo, field, meta);
		}
	}

	const mergeMethods = [
		this.mergeTab,
		this.mergeFrame,
		this.mergeClickData,
		this.mergeSchemaOrg,
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
		this.removeTitleUrlDuplicate,
		this.makeDuplicationRemover("title", "description"),
		this.makeDuplicationRemover("linkUrl", "linkText"),
		this.removeNonCanonicalSlash,
		this.removeSelfLink,
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

lr_meta.removeTitleUrlDuplicate = function(metaMap) {
	// Strip leading `http://`, `file://` or `view-source:`
	const urlSet = new Set((metaMap.get('url') || [])
		.map(entry => entry.value && entry.value.replace(/^[a-zA-Z][-_+a-zA-Z0-9]*:(?:\/\/)?/, "")));
	if (!(urlSet.size > 0)) {
		return;
	}
	const titleVariants = (metaMap.get('title') || []).slice();
	for (let title of titleVariants) {
		if (urlSet.has(title.value)) {
			console.debug("LR clean meta: remove title similar to url %o", title);
			metaMap.deleteValue("title", title.value);
		}
	}
};

lr_meta.makeDuplicationRemover = function(primary, forCleanup) {
	const name = `removeDuplicate_${forCleanup}_${primary}`;
	const obj = {
		[name]: function(metaMap) {
			const primarySet = new Set((metaMap.get(primary) || []).map(entry => entry.value));
			if (!(primarySet.size > 0)) {
				return;
			}
			const variants = (metaMap.get(forCleanup) || []).slice();
			for (let v of variants) {
				if (v.value && primarySet.has(v.value)) {
					console.debug("LR clean meta: remove %s similar to %s: %o",
						forCleanup, primary, v);
					metaMap.move(v, forCleanup, primary);
				}
			}
		}
	};
	return obj[name];
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

/**
 * Discard `target` property if all `linkUrl` values present
 * in `url` properties if hash (fragment anchor) part of URLs are removed.
 * Link considered external in the case of invalid or "data:" URL.
 * "javascript:" links are considered as having target withing the same page.
 */
lr_meta.removeSelfLink = function(meta) {
	if (lr_meta.firstValue(meta.descriptors("target", "clickData.captureObject")) !== 'link') {
		return meta;
	}
	let foreignCandidates = [];
	let selfLinks = [];
	for (const link of meta.get('linkUrl') || []) {
		if (!link || !link.value) {
			continue;
		} else if (link.value.startsWith('data:')) {
			return meta;
		} else if (link.value.startsWith('javascript:')) {
			continue;
		} else {
			foreignCandidates.push(link);
		}
	}
	if (foreignCandidates.length >= 0) {
		const urlSet = new Set();

		// May throw
		function removeUrlHash(href) {
			const url = new URL(href);
			url.hash = "";
			return url.href;
		}

		for (const entry of meta.get('url')) {
			try {
				if (!entry || !entry.value) {
					continue;
				}
				urlSet.add(removeUrlHash(entry.value));
			} catch (ex) {
				console.debug("lr_meta.removeSelfLink", ex);
			}
		}
		for (const link of foreignCandidates) {
			try {
				if (urlSet.has(removeUrlHash(link.value))) {
					selfLinks.push(link);
				} else {
					return meta;
				}
			} catch (ex) {
				return meta;
			}
		};
	}
	for (const link of selfLinks) {
		meta.move(link, 'linkUrl', 'url');
	}

	meta.deleteValue("target", "link");
	return meta;
};

lr_meta.mergeSchemaOrg = function(_frameInfo, meta) {
	for (const descriptor of meta.descriptors("schema_org")) {
		try {
			const { value, keys } = descriptor;
			lr_schema_org.mergeUntyped(value, meta, keys ? { key:  keys[0] } : undefined);
		} catch (ex) {
			console.error("lr_meta.mergeSchemaOrg: untyped: %o", ex);
			meta.addDescriptor("error", {
				value: lr_util.errorToObject(ex),
				key: `schema_org.${descriptor.key}`,
			});
		}
	}
	try {
		lr_schema_org.mergeMainEntry(meta);
	} catch (ex) {
		console.error("lr_meta.mergeSchemaOrg: main: %o", ex);
		meta.addDescriptor("error", {
			value: lr_util.errorToObject(ex),
			key: 'schema_org.main',
		});
	}
};

lr_meta.mapToUrls = function(meta) {
	const result = [];
	const linkUrls = [...lr_meta.validUrls(meta.descriptors("linkUrl"))];
	if (linkUrls.length > 0) {
		const link = { _type: "Link", urls: linkUrls };
		const linkText = lr_meta.firstText(meta.descriptors("linkText"));
		if (linkText) {
			link.text = linkText.substring(0, 72);
		}
		result.push(link);
	}
	const srcUrls = [...lr_meta.validUrls(meta.descriptors("srcUrl"))];
	if (srcUrls.length > 0) {
		const image = { _type: "Image", urls: srcUrls };
		const imageText = lr_meta.firstText(
			meta.descriptors("imageAlt"),
			meta.descriptors("imageTitle")
		);
		if (imageText) {
			image.text = imageText.substring(0, 72);
		}
		result.push(image);
	}
	const urls = [...lr_meta.validUrls(meta.descriptors("url"))];
	if (urls.length > 0) {
		const frame = { _type: "Frame", urls };
		const title = lr_meta.firstText(
			meta.descriptors("title", "tab.title"),
			meta.descriptors("title")
			// TODO selection text if no link or image
		);
		if (title) {
			frame.title = title.substring(0, 72);
		}
		result.push(frame);
	}
	return result;
};

lr_meta.html_entity_string = Object.assign(Object.create(null), {
	amp: "&",
	quot: '"',
	apos: "'",
	gt: ">",
	hellip: "…",
	lt: "<",
	mdash: "\u2014",
	ndash: "\u2013",
	nbsp: "\u00a0",
	laquo: "«",
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

lr_meta.htmlJsonEntityReplaceCb = function(match, p1) {
	const replacement = lr_meta.htmlEntityReplaceCb(match, p1);
	return replacement === '"' || replacement === "\\" ?
		"\\" + replacement : replacement;
}

lr_meta.unescapeEntities = function(str, options) {
	if (!str) {
		return str;
	}
	const cb = options && options.json ?
		lr_meta.htmlJsonEntityReplaceCb : lr_meta.htmlEntityReplaceCb;
	return str.replace(/&([a-zA-Z]+|#[xX]?[0-9]+);/g, cb);
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
