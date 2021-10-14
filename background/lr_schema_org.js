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

var lr_schema_org = lr_util.namespace(lr_schema_org, function lr_schema_org() {
	var lr_schema_org = this;

	function stripSchemaOrg(type) {
		return type && typeof type === 'string' ?
			type.replace(/^https?:\/\/schema.org\//, '') : undefined;
	}

	class Key extends Array {
		toString() {
			return this.join(".");
		};
		push(...args) {
			console.error("Do not use lr_schema_org.Key.push(). Replaced by concat.");
			return this.concat(...args);
		};
	}

	const _basicTypes = new Set([ Number, String, Date, URL, Function ]);

	class LrSchemaOrgUnified {
		constructor(meta) {
			this.idMap = new Map();
			this.roots = new Set();

			for (const descriptor of meta.descriptors("schema_org")) {
				try {
					const { value, keys } = descriptor;
					this._addObject(value, keys);
				} catch (ex) {
					// TODO make it more visible
					console.error("LrSchemaOrgUnified: ignored error: %o", ex);
				}
			}
		}

		_addObject(json, keys) {
			const { idMap, roots } = this;
			const queue = [ { node: json, keys } ];

			while (queue.length > 0) {
				const { node, parent, keys } = queue.pop();
				if (node == null || _basicTypes.has(Object.getPrototypeOf(node).constructor)) {
					continue;
				}
				if (Array.isArray(node)) {
					queue.push(...node.map(n => ({ node: n, parent })));
					continue;
				}

				const id = node['@id'];
				if (!parent && ((id != null && id !== "") || node['@type'])) {
					roots.add({ node, keys });
				}
				if (id != null && id !== "") {
					const existing = idMap.get(id);
					if (node['@type']) {
						if (existing && existing.node) {
							console.warn(
								"lr_schema_org.fillIdMap: replacing %o %o",
								id, node['@type']);
						}
						idMap.set(id, existing ? { ...existing, node, keys } : { node, keys });
					} else {
						idMap.set(id, existing ? { ...existing, backRef: true, keys } : { backRef: true });
					}
				}
				for (const [key, value] of Object.entries(node)) {
					if (["@unnamed", "@graph"].indexOf(key) >= 0) {
						queue.push({ node: value, parent });
					} else if (typeof key !== 'string' || !key.startsWith("@")) {
						queue.push({ node: value, parent: node });
					}
				}
			}
		}

		*_roots() {
			const { idMap, roots } = this;
			for (const item of roots) {
				const id = item.node["@id"];
				if (id == null || id === "") {
					yield item;
					continue;
				}
				const entry = idMap.get(id);
				console.assert(entry != null);
				if (entry && !entry.backRef) {
					yield entry;
				}
			}
		}

		findMainEntity() {
			// Silently ignore priority of 0
			const typePriorities = {
				"Product": 40,
				"Article": 30,
				"NewsArticle": 30,
				"BlogPosting": 30,
				"WebPage": 20,
				"WebSite": 10,
				"BreadcrumbList": 0,
			}
			const priorityCount = new lr_multimap.LrMultiMap();
			for (const entry of this._roots()) {
				const type = entry.node["@type"];
				const priority = typePriorities[type];
				if (priority === undefined) {
					console.debug("LrSchemaOrgUnified.findMainEntity: unknown type %o of %o", type, entry);
				}
				if (priority > 0) {
					priorityCount.set(priority, entry);
				}
			}
			const foundPriorities = Array.from(priorityCount.keys());
			foundPriorities.sort((a, b) => b - a);
			for (const priority of foundPriorities) {
				const variants = Array.from(priorityCount.get(priority));
				if (variants.length === 1) {
					return variants[0];
				}
				// TODO Check by `@id` whether the same entry is obtained from e.g.
				// microdata and JSON-LD
				console.debug("LrSchemaOrgUnified.findMainEntity: ambiguous ignored: %o", variants);
			}
			return undefined;
		}
	}

	function byId(element, idMap) {
		const id = element && element["@id"];
		const mapped = idMap && id && idMap.get(id);
		return (mapped && mapped.node) || element;
	}

	function handlePropertyGeneric(json, meta, field, { key, ...props }) {
		// Organization, etc.
		return setProperty(json, "name", meta, field, { ...props, key, recursive: false });
	}

	function setProperty(src, srcField, meta, property, propsAll) {
		if (propsAll == null) {
			console.warn(
				"lr_schema_org.setProperty(%o, %o, %o, %o, %o): caller error: no props",
				src, srcField, meta, property, propsAll);
			return false;
		}
		let { attrs = {}, key, handler, recursive, recursionLimit, ...props } = propsAll;
		if (! (--recursionLimit >= 0)) {
			console.warn("lr_schema_org.setProperty: recursion limit reached %s %s", property, key);
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
			return meta.addDescriptor(property, { ...attrs, value, key: "" + key });
		} else if (Array.isArray(value)) {
			let i = 0;
			for (const item of value) {
				result = setProperty(item, null, meta, property,
					{ ...props, attrs, key: "" + key, recursive, recursionLimit }) || result;
			}
		} else if (value["@type"]) {
			const type = value["@type"];
			const typedKey = key.concat(type);
			if (handler) {
				result = handler(value, meta, property,
					{ ...props, key: typedKey, recursive: false, recursionLimit });
			} else if (recursive) {
				const handler = propertyHandlerMap.get(type);
				if (handler) {
					// run always
					result = handler(value, meta, property,
						{ ...props, key: typedKey, recursive: false, recursionLimit }) || result;
				}
				// run only if unhandled
				result = result || handlePropertyGeneric(value, meta, property,
					{ ...props, key: typedKey, recursive: false, recursionLimit });
			} else {
				console.warn(
					"lr_schema_org.setProperty: recursion is not allower for %s(%s): %s",
					property, key, value);
			}
		}
		return result;
	}

	function findTopPartOf(json, { key, idMap, recursionLimit }) {
		// TODO WebSite even if there is no `isPartOf` or `mainEntityOfPage` relation.
		let result = null;
		let candidate = json;
		while (recursionLimit-- > 0 && (candidate = candidate["isPartOf"])) {
			result = candidate = byId(candidate, idMap);
			key = key.concat("isPartOf", candidate["@type"]);
		}
		if (!(recursionLimit >= 0)) {
			console.warn("lr_schema_org.findTopPartOf: recursion limit reached while looking for top parent");
		}
		return [result, key];
	}

	function handleImageObjectProperty(json, meta, property, { key, ...props }) {
		return meta.addDescriptor(property, { value: json.url, key: "" + key.concat("url") }, { skipEmpty: true });
		// @id likely contains anchor on the page, not an image URL
	};

	function handlePersonProperty(json, meta, property, { key, ...props }) {
		const nameComponents = [];
		const alternativeNames = [];
		function fillNameComponents(obj, array) {
			for (const field of ["givenName", "additionalName", "familyName"]) {
				const value = obj[field];
				if (typeof value === 'string' && value !== "") {
					array.push(value);
				}
			}
		}
		fillNameComponents(json, nameComponents);
		const name = json["name"];
		const nameIsString = name && typeof name === "string";
		if (nameComponents.length > 0) {
			if (nameIsString) {
				alternativeNames.push(name);
			} else if (name) {
				const add = [];
				fillNameComponents(name, add);
				if (add.length > 0) {
					alternativeNames.push(add.join(" "));
				}
			}
		} else if (nameIsString) {
			nameComponents.push(name);
		} else if (name) {
			// https://developers.google.com/web/updates
			// has name as subobject despite it should be text
			fillNameComponents(name, nameComponents);
		}

		const alternative = json['alternativeName'];
		if (alternative && typeof alternative === 'string') {
			if (nameComponents.length > 0) {
				alternativeNames.push(alternative);
			} else {
				nameComponents.push(alternative);
			}
		}
		if (alternativeNames.length > 0) {
			nameComponents.push("(" + alternativeNames.join(", ") + ")");
		}
		if (!(nameComponents.length > 0)) {
			console.warn("lr_schema_org.handlePersonProperty: %o: found nothing useful", key);
		}
		return meta.addDescriptor(
			property,
			{
				value: nameComponents.join(" "),
				key: "" + key,
			},
			{ skipEmpty: true });
	}

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
		setProperty(json, "creator", meta, "author", { ...props, recursive: true });
		const [topParent, topKey] =
			findTopPartOf(json, props);
		setProperty(topParent, "name", meta, "site_name",
			{ ...props, key: topKey, recursive: false });
		setProperty(json, "publisher", meta, "site_name",
			{ ...props, recursive: true });
		return true;
	}

	function handleAggregateRatingProperty(json, meta, property, { key }) {
		let value = json.ratingValue;
		const bestRating = json.bestRating;
		if (bestRating) {
			let rating = bestRating;
			const worstRating = json.worstRating;
			if (worstRating) {
				rating = worstRating + "-" + rating;
			}
			value = (value || "-") + "/" + rating;
		}
		const ratingCount = [];
		if (json.ratingCount && json.ratingCount != "0") {
			ratingCount.push(json.ratingCount);
		}
		const reviewCount = json.reviewCount || (ratingCount.length > 0 ? "0" : undefined);
		if (reviewCount) {
			ratingCount.unshift(reviewCount);
		}
		if (ratingCount.length > 0) {
			value = (value || "-") + "(" + ratingCount.join("; ") + ")";
		}
		return meta.addDescriptor( property, { value, key: "" + key, }, { skipEmpty: true });
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
		setProperty(json, "url", meta, "url", nonrecursiveProps);
		const id = json["@id"];
		if (id) {
			try {
				const url = new URL(id);
				if (url.hostname) {
					meta.addDescriptor("url", { value: id, key: "" + props.key.concat("id") });
				}
			} catch (ex) {
				console.debug(
					"lr_schema_org.handlePrimaryThing: allowed failure id -> url: %s %s %o",
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
				console.warn("lr_schema_org.handlePrimaryThing: recursion limit reached, skipping main entity");
			}
		}
		return true;
	}

	const primaryTypeHandlerMap = new Map();
	function registerPrimaryTypeHandler(type, handler) {
		if (primaryTypeHandlerMap.has(type)) {
			console.warn(
				"lr_schema_org.registerPrimaryTypeHandler: handler for type '%s' already registered, overriding it", type);
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
				"lr_schema_org.registerPropertyHandler: handler for property type '%s' already registered, overriding it", type);
		}
		propertyHandlerMap.set(type, handler);
	}

	registerPropertyHandler("ImageObject", handleImageObjectProperty);
	registerPropertyHandler("Person", handlePersonProperty);
	registerPropertyHandler("AggregateRating", handleAggregateRatingProperty);

	function handlePrimaryTyped(json, meta, props) {
		const type = json["@type"];
		if (!type) {
			return false;
		}
		const handler = primaryTypeHandlerMap.get(type);
		if (!handler) {
			console.warn('lr_schema_org.handlePrimaryTyped: unsupported type of primary entry "%s"', type); 
			return false;
		}
		const key = props.key.concat(type);
		return handler(json, meta, { ...props, key });
	}

	function mergeMainEntry(meta, options) {
		const unified = new LrSchemaOrgUnified(meta);
		const mainEntry = unified.findMainEntity();
		if (mainEntry === undefined) {
			return false;
		}
		const key = new Key(mainEntry.keys && mainEntry.keys[0] || "schema_org");
		const props = { key, recursionLimit: 32, idMap: unified.idMap };
		const result = handlePrimaryTyped(mainEntry.node, meta, props);
		if (!result) {
			console.warn("lr_schema_org.mergeMainEntry: unsupported: %o", mainEntry);
		}
		return result;
	}

	/** Gather meta elements scattered over the document without itemscope
	 * or JSON-LD without explicit type.
	 * Can it be considered as implicit `WebPage` type? */
	function mergeUntyped(json, meta, options) {
		if (!json || _basicTypes.has(json)) {
			return false;
		}
		if (Array.isArray(json)) {
			if (json.length !== 1) {
				return false;
			}
			json = json[0];
		}
		if (json["@type"] || json["@graph"]) {
			return false;
		}
		const key = new Key(options && options.key || "schema_org.no_scope");
		const props = { key, recursionLimit: 32 };
		return handlePrimaryCreativeWork(json, meta, props);
	}

	Object.assign(this, {
		LrSchemaOrgUnified,
		handlePrimaryThing,
		mergeMainEntry,
		mergeUntyped,
		setProperty,
		stripSchemaOrg,
		internal: {
			byId,
			handleImageObjectProperty,
			handlePrimaryCreativeWork,
			handlePrimaryWebPage,
			handlePrimaryTyped,
			primaryTypeHandlerMap,
			propertyHandlerMap,
		},
	});
	return this;
});
