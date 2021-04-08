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

var lr_json_ld = lr_util.namespace("lr_json_ld", lr_json_ld, function lr_json_ld() {
	class Key extends Array {
		toString() {
			return this.join(".");
		};
		push(...args) {
			console.error("Do not use lr_json_ld.Key.push(). Replaced by concat.");
			return this.concat(...args);
		};
	}

	function handleGraph(json, meta, props) {
		const nodes = Array.isArray(json) ? json : json["@graph"];
		if (!Array.isArray(nodes)) {
			return false;
		}
		// build id -> node map
		const idMap = new Map();
		for (const n of nodes) {
			if (!n["@type"]) {
				continue;
			}
			const id = n["@id"];
			if (id) {
				idMap.set(id, n);
			}
		}

		const nodeLevel = {
			"Article": 0,
			"NewsArticle": 0,
			"BlogPosting": 0,
			"WebPage": 1,
			"WebSite": 2,
		};
		const seenNodesPerLevel = [[], [], []];
		for (const n of nodes) {
			const level = nodeLevel[n["@type"]];
			if (level != null) {
				seenNodesPerLevel[level].push(n);
			}
		}
		for (const levelNodes of seenNodesPerLevel) {
			if (levelNodes.length !== 1) {
				// Either no items at all on this level
				// or we should generate metadata for more general level
				// till particular part of page will be provided.
				continue;
			}
			return handlePrimaryTyped(levelNodes[0], meta, { ...props, idMap });
		}
		console.warn('lr_json_meta: have not found useful info in the @graph');
		return false;
	}
	
	function byId(element, idMap) {
		const id = element && element["@id"];
		return (idMap && id && idMap.get(id)) || element;
	}

	function handlePropertyGeneric(json, meta, field, { key, ...props }) {
		// Person, Organization
		return setProperty(json, "name", meta, field, { ...props, key, recursive: false });
	}

	function setProperty(src, srcField, meta, field, { key, recursive, recursionLimit, ...props }) {
		if (! (--recursionLimit >= 0)) {
			console.warn("LR: ld+json: setProperty: recursion limit reached %s %s", field, key);
			return false;
		}
		let value = srcField == null ? src : (src && src[srcField]);
		if (srcField) {
			key = key.concat(srcField);
		}
		let result = false;
		value = byId(value, props.idMap);
		if (value == null || value === "") {
			return result;
		} else if (typeof value === "string") {
			return meta.set(field, value, key);
		} else if (Array.isArray(value)) {
			let i = 0;
			for (const item of value) {
				result = setProperty(item, null, meta, field,
					{ ...props, key: key.concat("" + i++), recursive, recursionLimit }) || result;
			}
		} else if (value["@type"]) {
			const type = value["@type"];
			const typedKey = key.concat(type);
			if (recursive) {
				const handler = propertyHandlerMap.get(type);
				if (handler) {
					// run always
					result = handler(value, meta, field,
						{ ...props, key: typedKey, recursive: false, recursionLimit }) || result;
				}
				// run only if unhandled
				result = result || handlePropertyGeneric(value, meta, field,
					{ ...props, key: typedKey, recursive: false, recursionLimit });
			} else {
				console.warn("LR: ld+json: recursion is not allower for %s(%s): %s", field, key, value);
			}
		}
		return result;
	}

	function findTopPartOf(json, { key, idMap, recursionLimit }) {
		let result = null;
		let candidate = json;
		while (recursionLimit-- > 0 && (candidate = candidate["isPartOf"])) {
			const id = candidate["@id"];
			if (id != null && idMap) {
				candidate = idMap.get(id) || candidate;
			}
			result = candidate;
			key = key.concat("isPartOf", candidate["@type"]);
		}
		if (!(recursionLimit >= 0)) {
			console.warn("LR: ld+json: recursion limit reached while looking for top parent");
		}
		return [result, key];
	}

	function handleImageObjectProperty(json, meta, field, { key, ...props }) {
		return meta.set(field, lr_meta.normalizeUrl(json.url), key.concat("url"));
		// @id likely contains anchor on the page, not an image URL
	};

	function handlePrimaryWebPage(json, meta, props) {
		handlePrimaryCreativeWork(json, meta, props);
		setProperty(json, "primaryImageOfPage", meta, "image", { ...props, recursive: true });
		return true;
	}

	function handlePrimaryCreativeWork(json, meta, props) {
		handlePrimaryThing(json, meta, props);
		const nonrecursiveProps = { ...props, recursive: false };
		const textFields = [
			["headline", "title"],
			["alternativeHeadline", "title"],
			["text", "description"],
			["datePublished", "published_time"],
			["dateCreated", "published_time"],
			["dateModified", "modified_time"],
		];
		for (const [property, target] of textFields) {
			setProperty(json, property, meta, target, nonrecursiveProps);
		}
		setProperty(json, "author", meta, "author", { ...props, recursive: true });
		const [topParent, topKey] =
			findTopPartOf(json, props);
		setProperty(topParent, "name", meta, "site_name",
			{ ...props, key: topKey, recursive: false });
		setProperty(json, "publisher", meta, "site_name",
			{ ...props, recursive: true });
	}

	function handlePrimaryThing(json, meta, props) {
		const nonrecursiveProps = { ...props, recursive: false };
		const textFields = [
			["name", "title"],
			["alternativeName", "title"],
			["description", "description"],
			["disambiguatingDescription", "description"],
		];
		for (const [property, target] of textFields) {
			setProperty(json, property, meta, target, nonrecursiveProps);
		}
		setProperty(json, "image", meta, "image", { ...props, recursive: true });
		meta.set("url", lr_meta.normalizeUrl(json.url), props.key.concat("url"));
		const id = json["@id"];
		if (id) {
			try {
				const url = new URL(id);
				if (url.hostname) {
					meta.set("url", lr_meta.normalizeUrl(id), props.key.concat("id"));
				}
			} catch (ex) {
				console.debug(
					"LR: json+ld: allowed failure id -> url: %s %s %o",
					id, ex, ex);
			}
		}
		// TODO sameAs for alternative urls
		const main = json.mainEntityOfPage || json.mainEntity;
		if (main) {
			let { key, idMap, recursionLimit } = props;
			--recursionLimit;
			if (recursionLimit >= 0) {
				const mainKey = key.concat("mainEntityOfPage");
				handlePrimaryTyped(
					byId(main, idMap), meta, { ...props, key, recursionLimit });
			} else {
				console.warn("LR: ld+json: recursion limit reached, skipping main entity");
			}
		}
		return true;
	}

	const primaryTypeHandlerMap = new Map();
	function registerPrimaryTypeHandler(type, handler) {
		if (primaryTypeHandlerMap.has(type)) {
			console.warn(
				"LR: ld+json: handler for type '%s' already registered, overriding it", type);
		}
		primaryTypeHandlerMap.set(type, handler);
	}

	registerPrimaryTypeHandler("Article", handlePrimaryCreativeWork);
	registerPrimaryTypeHandler("BlogPosting", handlePrimaryCreativeWork);
	registerPrimaryTypeHandler("NewsArticle", handlePrimaryCreativeWork);
	registerPrimaryTypeHandler("Thing", handlePrimaryThing);
	registerPrimaryTypeHandler("WebPage", handlePrimaryWebPage);
	registerPrimaryTypeHandler("WebSite", handlePrimaryCreativeWork);

	const propertyHandlerMap = new Map();
	function registerPropertyHandler(type, handler) {
		if (propertyHandlerMap.has(type)) {
			console.warn(
				"LR: ld+json: handler for property type '%s' already registered, overriding it", type);
		}
		propertyHandlerMap.set(type, handler);
	}

	registerPropertyHandler("ImageObject", handleImageObjectProperty);

	function handlePrimaryTyped(json, meta, props) {
		const type = json["@type"];
		if (!type) {
			return false;
		}
		const handler = primaryTypeHandlerMap.get(type);
		if (!handler) {
			console.warn('LR: ld+json: unsupported type of primary entry "%s"', type); 
			return false;
		}
		const key = props.key.concat(type);
		handler(json, meta, { ...props, key });
		return true;
	}

	function mergeJsonLd(json, meta, options) {
		if (!json) {
			return false;
		}
		const key = new Key(options && options.key || "ld_json");
		const props = { key, recursionLimit: 32 };
		const result = handleGraph(json, meta, props) || handlePrimaryTyped(json, meta, props);
		if (!result) {
			console.warn("LR: ld+json: unsupported structure");
		}
		return result;
	}

	Object.assign(this, {
		mergeJsonLd,
		internal: {
			byId,
			handleImageObjectProperty,
			handlePrimaryCreativeWork,
			handlePrimaryThing,
			handlePrimaryWebPage,
			handlePrimaryTyped,
			handleGraph,
			primaryTypeHandlerMap,
			propertyHandlerMap,
		},
	});
	return this;
});
