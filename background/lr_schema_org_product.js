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

var lr_schema_org_product = lr_util.namespace(lr_schema_org_product, function lr_schema_org_product() {
	var lr_schema_org_product = this;

	function getOfferStruct(json) {
		if (!json || !(["Offer", "AggregateOffer"].indexOf(json["@type"]) >= 0)) {
			return undefined;
		}

		function formatPrice(json, formatter, formatterNoCurrency) {
			let price = json.price;
			if (price !== null) {
				// `0` as a number should be skipped here.
				price = price && price !== "0" ? formatter(price) : undefined;
			}
			let range = [];
			for (const field of ["lowPrice", "highPrice"]) {
				const value = json[field];
				// `0` as a number almost certainly should be skipped.
				// An exception might be `lowPrice = 0`, `highPrice = 12.34`
				// when there is an offer with `price = 9.99` in the list.
				if (value && value !== "0") {
					range.push(price ?  formatterNoCurrency(value) : formatter(value));
				}
			}
			range = range.join("-");
			if (range) {
				price = price ? price + "/" + range : range;
			}
			const offerCount = json.offerCount;
			if (price && offerCount  && offerCount !== "1") {
				price = price + "(" + offerCount + ")";
			}
			return price;
		}

		let price;
		const currency = json.priceCurrency;
		if (currency) {
			try {
				const f = new Intl.NumberFormat(navigator.language, { style: "currency", currency });
				price = formatPrice(json, f.format.bind(f), x => x);
			} catch (ex) {
				console.warn("lr_schema_org.handleAggregateOfferProperty: falback due to: %o", ex);
				price = formatPrice(json, x => `${x} ${currency}`, x => x);
			}
		} else {
			price = formatPrice(json, x => x, x => x);
		}
		const result = {};
		let has_props = false;
		if (price) {
			has_props = true;
			result.price = price;
		}
		const availability = json.availability;
		if (availability && typeof availability === 'string') {
			result.availability = lr_schema_org.stripSchemaOrg(availability);
			has_props = true;
		}
		for (const field of ["url", "name"]) {
			const value = json[field];
			if (value && typeof value === 'string') {
				result[field] = value;
				has_props = true;
			}
		}
		return has_props ? result : undefined;
	}

	function handlePrimaryProduct(json, meta, props) {
		lr_schema_org.handlePrimaryThing(json, meta, props);
		lr_schema_org.setProperty(json, "brand", meta, "brand", { ...props, recursive: false });
		const propertyFields = [
			"manufacturer",
			"size", "color", "pattern", "material",
			"itemCondition",
			"width", "height", "depth", "weight", // there is no "length" in the schema
			"countryOfOrigin", "countryOfAssembly",
			"productionDate", "releaseDate",
			"category", "sku", "productID", "gtin",
		];
		for (const field of propertyFields) {
			lr_schema_org.setProperty(
				json, field, meta, "genericProperty",
				{ ...props, attrs: { name: field }, recursive: false });
		}
		let offer = json.offer || json.offers;
		// TODO try-catch or executor.step
		if (offer != null) {
			if (Array.isArray(offer) && offer.length === 1 && offer[0] != null) {
				offer = offer[0];
			}

			if (!Array.isArray(offer)) {
				const offerStruct = getOfferStruct(offer);
				if (offerStruct !== undefined) {
					const mapping = [
						[ "price", "price" ],
						[ "model", "model" ],
						[ "availability", "availability" ],
						[ "name", "offerName" ],
						[ "url", "url" ],
					];
					for (const [src, target] of mapping) {
						lr_schema_org.setProperty(
							offerStruct, src, meta, target, { ...props, recursive: false });
					}
				}
				offer = offer.offer || offer.offers;
			}

			// No `else` here, it may be "offers" from "AggregareOffer" already.
			if (Array.isArray(offer)) {
				for (const item of offer) {
					meta.addDescriptor(
						"offer",
						{ value: getOfferStruct(item), key: "" + props.key.concat("offer"), },
						{ skipEmpty: true });
				}
			}
		}

		lr_schema_org.setProperty(
			json, "additionalProperty", meta, "genericProperty",
			{ ...props, recursive: true, handler: lr_schema_org.handlePropertyValueProperty });
		lr_schema_org.setProperty(json, "aggregateRating", meta, "aggregateRating", { ...props, recursive: true });

		let primaryScore = 0;
		for (const property of ["brand", "model", "price", "offer", "availability", "aggregateRating"]) {
			for (const _ of meta.descriptors(property)) {
				++primaryScore;
			}
		}
		let secondaryScore = 0;
		for (const property of ["genericProperty", "title"]) {
			for (const _ of meta.descriptors(property)) {
				++secondaryScore;
			}
		}
		if (!(primaryScore > 0)) {
			return false;
		}
		meta.addDescriptor(
			"schema_orgPrimaryScore",
			{ value: primaryScore, key: "" + props.key });
		meta.addDescriptor("schema_orgSecondaryScore",
			{ value: secondaryScore, key: "" + props.key });
		return true;
	}

	function preferredProductTitle(specialMeta, meta) {
		const { cleanupTitleVariant, preferShort, valuesFromDescriptors } = lr_format_org;
		const fallbackTitle = "Product";
		const componentSeparator = " — "; // First whitespace is unbreakable.

		try {
			const toRemoveFromTitle = Array.from(valuesFromDescriptors(lr_iter.combine(
				specialMeta.descriptors("brand"),
				specialMeta.descriptors("model"),
				meta.descriptors("site_name"),
			)));
			function singleLineValue(descriptor) {
				return {
					...descriptor,
					value: lr_formatter.ensureSingleLine(descriptor.value),
				};
			}
			const titleCandidates = valuesFromDescriptors(lr_meta.errorsLast(lr_iter.combine(
				preferShort(lr_iter.map(
					lr_iter.combine(specialMeta.descriptors("title"), meta.descriptors("title")),
					singleLineValue)),
				preferShort(lr_iter.map(
					lr_iter.combine(
						specialMeta.descriptors("description"),
						meta.descriptors("description"),
					),
					singleLineValue)),
					// TODO consider selection line
				),
			));
			let title = null;
			for (title of titleCandidates) {
				title = cleanupTitleVariant(title, toRemoveFromTitle);
				if (title) {
					break;
				}
			}
			const toRemoveFromSite = Array.from(valuesFromDescriptors(lr_iter.combine(
				specialMeta.descriptors("brand"),
				specialMeta.descriptors("model"),
			)));
			let site_name = null;
			for (site_name of valuesFromDescriptors(lr_format_org.siteNameVariants(meta))) {
				site_name = cleanupTitleVariant(site_name, toRemoveFromSite);
				if (site_name) {
					break;
				}
			}

			const titleComponents = [
				{
					value: title,
					min: 30,
					target: 48,
					stiff: 48,
					flexThreshold: 48,
				},
				{
					value: lr_iter.first(valuesFromDescriptors(lr_meta.errorsLast(
						preferShort(specialMeta.get("price"))))),
					min: 8,
					target: 12,
					stiff: 12,
					flexThreshold: 12,
				},
				{
					value: lr_iter.first(valuesFromDescriptors(lr_meta.errorsLast(
						preferShort(specialMeta.get("availability"))))),
					min: 8,
					target: 12,
					stiff: 12,
					flexThreshold: 12,
				},
				{
					value: lr_iter.first(valuesFromDescriptors(lr_meta.errorsLast(
						preferShort(specialMeta.get("aggregateRating"))))),
					min: 8,
					target: 12,
					stiff: 12,
					flexThreshold: 12,
				},
				{
					value: site_name,
					min: 8,
					target: 24,
					stiff: 0,
					flexThreshold: 8,
				}
			];
			for (const field of ["model", "brand"]) {
				const value = lr_iter.first(valuesFromDescriptors(lr_meta.errorsLast(
					preferShort(specialMeta.get(field)))));
				const index = value && title.search(value);
				if (value && !(index >= 0 && index <= 48 - value.length)) {
					titleComponents.unshift({
						value, min: 8, target: 12, stiff: 12, flexThreshold: 12,
					});
				}
			}
			const truncated = lr_format_org.limitComponentsLength(titleComponents);
			if (truncated && truncated.length > 0) {
				return truncated.join(componentSeparator);
			}
			const href = lr_iter.first(valuesFromDescriptors(urlVariants(meta)));
			if (href) {
				const link = lr_org_tree.LrOrgLink({ lengthLimit: 75 - fallbackTitle.length, href });
				return [ fallbackTitle, componentSeparator, link ];
			}
		} catch (ex) {
			console.error(ex);
		}
		return [ fallbackTitle, componentSeparator, new Date() ];
	}

	function lr_format_org_product_frame(specialMeta, meta, options = {}) {
		const {
			LrOrgDefinitionItem, LrOrgHeading, LrOrgSeparatorLine, LrOrgWordSeparator, LrOrgLink,
		} = lr_org_tree;

		const title = preferredProductTitle(specialMeta, meta);
		let url = null;
		const properties = options.baseProperties && options.baseProperties.slice() || [];
		// Images may be more important for products, so lrOrgCollectProperties is not used here.
		for (let time of meta.descriptors('lastModified')) {
			// FIXME error
			properties.push(["LAST_MODIFIED", ...lr_formatter.parseDate(time.value)]);
		}
		const body = [];

		const addedValues = new Set();
		const urlVariants = lr_iter.combine(
			lr_format_org.urlVariants(meta),
			lr_format_org.urlVariants(specialMeta), // URL from offer
		);
		for (let variant of urlVariants) {
			if (addedValues.has(variant.value)) {
				continue;
			}
			addedValues.add(variant.value);
			body.push(LrOrgDefinitionItem({ term: "URL" }, LrOrgLink({ href: variant.value })));
			if (url == null) {
				url = variant.value;
			}
		}
		addedValues.clear();

		for (const property of ["model", "brand", "price", "availability", "aggregateRating"]) {
			for (const descriptor of lr_meta.errorsLast(specialMeta.descriptors(property))) {
				if (addedValues.has(descriptor.value)) {
					continue;
				}
				addedValues.add(descriptor.value);
				body.push(LrOrgDefinitionItem({ term: property }, descriptor.value));
			}
		}
		for (const titleVariant of lr_sorted_title(meta)) {
			if (addedValues.has(titleVariant)) {
				continue;
			}
			addedValues.add(titleVariant);
			body.push(LrOrgDefinitionItem({ term: "title" }, titleVariant));
		}
		for (let property of ['published_time', 'modified_time']) {
			for (const descriptor of meta.descriptors(property)) {
				try {
					const value = lr_formatter.parseDate(descriptor.value);
					body.push(LrOrgDefinitionItem({ term: property }, value));
				} catch (ex) {
					console.error(
						"lr_format_org_product_frame: ignoring error for: %o %o",
						descriptor, ex);
				}
			}
		}
		for (const descriptor of specialMeta.descriptors('offerName')) {
			body.push(LrOrgDefinitionItem({ term: 'offer' }, descriptor.value));
		}
		for (const descriptor of meta.descriptors('author')) {
			body.push(LrOrgDefinitionItem({ term: 'author' }, descriptor.value));
		}
		for (let descriptor of specialMeta.descriptors('genericProperty')) {
			body.push(LrOrgDefinitionItem({ term: descriptor.name }, descriptor.value));
		}
		for (descriptor of lr_format_org.siteNameVariants(meta)) {
			body.push(LrOrgDefinitionItem({ term: "site name" }, descriptor.value));
		}
		if (options.addReferrer && !options.separateReferrer) {
			body.push(...lr_format_org_referrer(meta));
		}
		// There should be no additional source of description in specialMeta,
		// however iterating over it will add duplicates.
		for (const description of lr_format_org.valuesFromDescriptors(lr_meta.errorsLast(
			lr_format_org.preferShort(meta.descriptors("description"))))
		) {
			body.push(LrOrgDefinitionItem({ term: "description" }, description));
		}
		for (const descriptor of meta.descriptors('image')) {
			body.push(LrOrgDefinitionItem(
				{ term: "image" }, LrOrgLink({ href: descriptor.value })));
		}
		for (const descriptor of specialMeta.descriptors('offer')) {
			const offer = descriptor.value;
			if (!offer) {
				continue;
			}
			const components = [];
			for (const field of ['model', 'name', 'price', 'availability']) {
				const value = offer[field];
				if (value) {
					components.push(value);
				}
			}
			const url = offer.url;
			if (url) {
				components.push(LrOrgLink({ href: url }));
			}
			const result = components.reduce((r, x) => {
				if (r.length > 0) {
					r.push(" ");
				}
				r.push(x);
				return r;
			}, []);
			if (result.length > 0) {
				body.push(LrOrgDefinitionItem({ term: "offer" }, ...result));
			}
		}
		if (lr_meta.firstValue(meta.descriptors("target")) !== "link") {
			// Link to particular part of the same page is not formatted as a link.
			body.push(...lr_format_org_link_text_properties(meta));
		}

		body.push(LrOrgSeparatorLine);
		if (!options.suppressSelection) {
			body.push(...lr_format_org_selection(meta));
			body.push(LrOrgSeparatorLine);
		}
		if (options.addReferrer && options.separateReferrer) {
			body.push(...lr_format_org_referrer(meta));
		}
		if (options.body) {
			body.push(LrOrgSeparatorLine, ...options.body);
		}
		return { title, url, tree: LrOrgHeading({ heading: title, properties }, ...body) };
	}

	Object.assign(lr_schema_org_product, {
		lr_format_org_product_frame,
	});

	lr_schema_org.registerSpecialTypeHandler("Product", handlePrimaryProduct);
	lr_format_org.registerSchemaOrgType(
		"Product", lr_schema_org_product.lr_format_org_product_frame);

	return lr_schema_org_product;
});
