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

var lr_format_org = lr_util.namespace(lr_format_org, function lr_format_org() {
	var lr_format_org = this;
	function* valueFromDescriptor(iterable) {
		if (!iterable) {
			return;
		}
		for (const descriptor of iterable) {
			if (descriptor.value && typeof descriptor.value === 'string') {
				yield descriptor.value;
			}
		}
	}

	function* preferShort(descriptorIterator) {
		if (!descriptorIterator) {
			return;
		}
		const descriptorArray = Array.from(descriptorIterator).filter(
			variant => variant.value && typeof variant.value === 'string');
		function compareShort(a, b) {
			if (!!a.error === !!b.error) {
				return a.value.length - b.value.length;
			}
			return a.error ? 1 : -1;
		}
		descriptorArray.sort(compareShort);
		yield* descriptorArray;
	}

	/** Use `twitter:site` only if no names suitable for humans are available. */
	function* siteNameVariants(meta) {
		const origVariants = meta && meta.get("site_name");
		const twitter = [];
		for (const item of preferShort(origVariants)) {
			if (
				item.value[0] === "@"
				&& item.keys.some(x => x.endsWith(".twitter:site"))
			) {
				twitter.push(item);
			} else {
				yield item;
			}
		}
		yield* twitter;
	}

	function* selectionLineGen(meta) {
		for (const key of [
			'window.getSelection.range',
			'window.getSelection.text',
			'clickData.selectionText',
		]) {
			const fragments = [];
			for (const descriptor of meta.descriptors('selection', key)) {
				const { value } = descriptor;
				if (Array.isArray(value)) {
					fragments.push(...value.map(e => e.value).filter(e => !!e));
				}
				if (fragments.length > 0) {
					yield fragments.join(" … ").replace(/\s+/g, " ");
					break;
				}
			}
		}
	}

	function* titleCandidatesIterator(meta) {
		yield* valueFromDescriptor(preferShort(meta.get('title')));
		yield* valueFromDescriptor(preferShort(meta.get('description')));
		yield* selectionLineGen(meta);
		// site_name is not here since it will be stripped anyway,
		// so it may be added at a later step.
	}

	function cleanupTitleVariant(text, toRemoveIterable) {
		let removed;
		do {
			removed = false;
			for (const toRemove of toRemoveIterable) {
				const index = text.indexOf(toRemove);
				if (!(index >= 0)) {
					continue;
				}
				if (index < 5) {
					text = text.substring(index + toRemove.length)
						.replace(/^[.,;:'´"»]\s*|^\s*(?:[-|—/]|::)\s*/, '');
					removed = true;
					break;
				} else if (index >= text.length - toRemove.length - 5 || index > 64) {
					text = text.substring(0, index)
						.replace(/[.,;:'`"«]\s*$|\s*(?:[-|—/]|::)\s*$/, '');
					removed = true;
					break;
				}
			}
		} while (removed);
		return text;
	}

	function* valuesFromDescriptors(iterable) {
		for (const descriptor of iterable || []) {
			if (descriptor && descriptor.value && typeof descriptor.value === 'string') {
				yield descriptor.value;
			}
		}
	}

	function prependUnique(prefix, text) {
		if (!prefix || text.indexOf(prefix) >= 0) {
			return text;
		}
		return [ prefix, text ].join(' — ');
	}

	function truncate(text, min, target, max) {
		if (!text || min == null) {
			return text;
		}
		if (target == null) {
			target = max = min;
		} else if (max == null) {
			max = target;
		}
		if (text.length <= target) {
			return text;
		}
		// capture next char that could be a space
		let retval = text.substring(0, max + 1);
		let leftSpread = Math.abs(target - min);
		leftSpread = leftSpread < 1 ? 1 : leftSpread;
		let rightSpread = Math.abs(max - target);
		rightSpread = rightSpread < 1 ? 1 : rightSpread;

		function splitByRegExp(str, re) {
			const splitVariants = [];
			for (const match of str.matchAll(re)) {
				const index = match.index;
				if (index < min) {
					continue;
				}
				splitVariants.push({
					index,
					penalty: (index <= target ? rightSpread : -leftSpread)*(target - index),
				});
			}
			splitVariants.sort((a, b) => a.penalty - b.penalty);
			const best = lr_iter.first(splitVariants);
			return best && best.index;
		}

		function truncated(str, index) {
			return str.substring(0, index) + "…";
		}
		const bySpace = splitByRegExp(retval, /\s+/g);
		if (bySpace != null) {
			return truncated(retval, bySpace);
		}
		if (text.length <= max) {
			return text;
		}

		const byPunct = splitByRegExp(retval, /[-!?,.;:\$#«„`\[({|\\\/<>@~*&+=—]/g);
		if (byPunct != null) {
			return truncated(retval, byPunct);
		}
		const byClosing = splitByRegExp(retval, /[\]})»']/g);
		if (byClosing != null) {
			return truncated(retval, byClosing + 1);
		}
		return truncated(retval, target);
	}

	function preferredPageTitle(meta) {
		const fallbackTitle = "Web Page"; // TODO i18n
		const componentSeparator = " — "; // First whitespace in unbreakable.
		try {
			let candidate = null;
			const toRemove = [
				...valuesFromDescriptors(meta.get("author")),
				...valuesFromDescriptors(meta.get("site_name")),
			];
			for (candidate of titleCandidatesIterator(meta)) {
				candidate = cleanupTitleVariant(candidate, toRemove);
				if (candidate) {
					break;
				}
			}
			const titleComponents = [
				{
					value: lr_iter.first(valuesFromDescriptors(preferShort(meta.get("author")))),
					min: 16,
					target: 24,
					stiff: 24,
					flexThreshold: 24,
				},
				{
					value: candidate,
					min: 30,
					target: 48,
					stiff: 48,
					flexThreshold: 48,
				},
				{
					value: lr_iter.first(valuesFromDescriptors(siteNameVariants(meta))),
					min: 8,
					target: 24,
					stiff: 0,
					flexThreshold: 8,
				}
			];
			const truncated = limitComponentsLength(titleComponents);
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

	function limitComponentsLength(titleComponents) {
		return limitComponentsLengthHelper(titleComponents).filter(c => c.value)
			.map(c => c.truncate ? truncate(c.value, c.min, c.truncate) : c.value);
	}

	function limitComponentsLengthHelper(titleComponents) {
		let targetSum = 0;
		let unprocessed = titleComponents.filter(c => {
			targetSum += c.target;
			if (!c.value) {
				return false;
			}
			return true;
		});

		let excess = -targetSum;
		unprocessed = unprocessed.filter(c => {
			c.truncate = Math.min(c.value.length, targetSum);
			excess += c.truncate;
			return c.truncate > c.flexThreshold;
		});
		if (excess <= 0) {
			return titleComponents;
		}
		for (let i = unprocessed.length; i-- > 0; ) {
			const invStiff0 = unprocessed.reduce((invStiff, c) => {
				return invStiff + (c.stiff ? 0 : 1./c.target);
			}, 0);
			if (!(invStiff0 > 0)) {
				break;
			}
			const strain = excess/invStiff0;
			let constrain = false;
			[ unprocessed, constrain ] = unprocessed.reduce(([res, cons], c) => {
				if (!c.stiff && c.truncate - Math.ceil(strain/c.target) <= c.min) {
					cons = true;
					excess -= c.truncate - c.min;
					c.truncate = c.min
				} else {
					res.push(c);
				}
				return [ res, cons ];
			}, [ [], constrain ]);
			if (constrain === true) {
				continue;
			}
			unprocessed = unprocessed.filter(c => {
				if (c.stiff) {
					return true;
				}
				const delta = Math.ceil(strain/c.target);
				c.truncate -= delta;
				console.assert(c.truncate >= c.min, "zero strain component min", c, strain, delta);
				excess -= delta;
				return false;
			});
		}
		if (excess <= 0) {
			return titleComponents;
		}
		for (let i = unprocessed.length; i-- > 0; ) {
			const invStiff = unprocessed.reduce((invStiff, c) => {
				console.assert(c.stiff > 0, "only positive stiff component should here", c);
				return invStiff + 1/c.stiff;
			}, 0);
			if (!(invStiff > 0)) {
				break;
			}
			const strain = excess/invStiff;
			let constrain = false;
			[ unprocessed, constrain ] = unprocessed.reduce(([res, cons], c) => {
				if (c.truncate - Math.ceil(strain/c.stiff) < c.min) {
					cons = true;
					excess -= c.truncate - c.min;
					c.truncate = c.min
				} else {
					res.push(c);
				}
				return [ res, cons ];
			}, [ [], constrain ]);
			if (constrain === true) {
				continue;
			}
			for (const c of unprocessed) {
				console.assert(c.stiff > 0, "Stiffness of remained components should be positive");
				const delta = Math.ceil(strain/c.stiff);
				c.truncate -= delta;
				console.assert(c.truncate >= c.min, "strain component min", c, strain);
				excess -= delta;
			}
			unprocessed = [];
			break;
		}
		console.assert(excess <= 0, "excess should be eliminated", excess, titleComponents);
		console.assert(unprocessed.length === 0, "no entries should remain unprocessed", unprocessed);
		return titleComponents;
	}

	function makeImageTitle(meta) {
		const { LrOrgWordSeparator, LrOrgLink } = lr_org_tree;
		const components = [ 'Image:' ]; // TODO i18n
		let text = lr_iter.first(lr_iter.combine(
			valuesFromDescriptors(meta.get('imageAlt')),
			valuesFromDescriptors(meta.get('imageTitle')),
			selectionLineGen(meta),
		));
		if (text) {
			components.push(LrOrgWordSeparator, truncate(text, 30, 72, 80));
		}
		const remaining = components.reduce((r, c) => r - c.length, 82);
		if (remaining > 25) {
			const descriptor = lr_iter.first(meta.get('srcUrl'));
			if (descriptor) {
				components.push(LrOrgWordSeparator, LrOrgLink({ descriptor, lengthLimit: remaining }));
			}
		}
		return components;
	}

	function makeLinkTitle(meta) {
		const { LrOrgWordSeparator, LrOrgLink } = lr_org_tree;
		const components = [ 'Link:' ]; // TODO i18n
		let text = lr_iter.first(lr_iter.combine(
			valuesFromDescriptors(meta.get('linkText')),
			valuesFromDescriptors(meta.get('linkTitle')),
			selectionLineGen(meta),
		));
		if (text) {
			components.push(LrOrgWordSeparator, truncate(text, 30, 72, 80));
		}
		const remaining = components.reduce((r, c) => r - c.length, 82);
		if (remaining > 25) {
			const descriptor = lr_iter.first(meta.get('linkUrl'));
			if (descriptor) {
				components.push(LrOrgWordSeparator, LrOrgLink({ descriptor, lengthLimit: remaining }));
			}
		}
		return components;
	}

	var urlWeightMap = new Map([
		// links to the same page are sorted first
		['link.href', 2000],
		['clickData.linkUrl', 2000],
		['link.canonical', 1000],
		['meta.property.og:url', 100],
		['clickData.srcUrl', 10],
	]);

	function urlWeight(url_src) {
		let weight = urlWeightMap.get(url_src);
		if (weight == null) {
			weight = 1;
		}
		if (url_src.startsWith("doi:")) {
			weight *= 8;
		} else if (/\.doi$/i.test(url_src)) {
			weight *= 7;
		}
		return weight;
	}

	function* urlVariants(meta) {
		if (!meta) {
			return;
		}
		const urlVariants = meta.get('url') || [];
		const weightedVariants = urlVariants
			.filter(x => x.value)
			.map(entry => ({
				value: entry.value,
				weight: entry.keys.map(urlWeight).reduce((a, b) => a + b, 0),
				error: entry.error,
			}));
		weightedVariants.sort((a, b) => {
			if (!a.error === !b.error) {
				return b.weight - a.weight;
			} else {
				return !b.error - !a.error;
			}
		});
		yield* weightedVariants;
	}

	Object.assign(this, {
		preferredPageTitle,
		makeImageTitle,
		makeLinkTitle,
		truncate,
		limitComponentsLength,
		urlVariants,
		internal: {
			preferShort,
			titleCandidatesIterator,
			cleanupTitleVariant,
			valuesFromDescriptors,
			urlWeightMap,
			urlWeight,
		},
	});
	return this;
});

function lr_sorted_title(meta) {
	if (!meta) {
		return [];
	}
	const titleVariants = meta.get('title') || [];
	const valueVariants = titleVariants.map(entry => entry.value);
	valueVariants.sort((a, b) => a.length - b.length);
	return valueVariants;
}

function lr_preferred_title(meta) {
	// FIXME limit title length
	// TODO fallback to selection, description fragment of reasonable length
	const valueVariants = lr_sorted_title(meta);
	return valueVariants.length > 0 ? valueVariants[0] : null;
}

function lr_format_org_description(meta) {
	if (!meta) {
		return null;
	}
	const variants = (meta.get('description') || []).slice();
	variants.sort((a, b) => {
		if (a.value.length != b.value.length) {
			return a.value.length - b.value.length;
		}
		return a.keys.length - b.keys.length;
	});
	return variants.length > 0 ? variants[0].value : null;
}

function lrOrgCollectProperties(result, frame) {
	let limit = 3;
	for (let img of frame.descriptors('image')) {
		if (!(limit--) > 0) {
			console.warn("lrOrgCollectProperties: skipping excessive URL_IMAGE variants");
			break;
		}
		// FIXME error
		result.push(["URL_IMAGE", img.value]);
	}
	for (let time of frame.descriptors('lastModified')) {
		// FIXME error
		result.push(["LAST_MODIFIED", ...lr_formatter.parseDate(time.value)]);
	}
	return result;
}

function lr_format_selection_body(descriptor) {
	const selection = descriptor.value;
	if (Array.isArray(selection)) {
		let lastError;
		const { LrOrgMarkup, LrOrgSeparatorLine, LrOrgWordSeparator } = lr_org_tree;
		const formatted = selection.reduce(function(result, descriptor) {
			const element = descriptor.value;
			const { error } = descriptor;
			if (result.length > 0) {
				if (element === "") {
					result.push(
						LrOrgSeparatorLine,
						LrOrgMarkup("..."),
						LrOrgSeparatorLine,
					);
				} else {
					const last = result[result.length - 1];
					if (last !== LrOrgSeparatorLine) {
						result.push(
							LrOrgWordSeparator, LrOrgMarkup("…"), LrOrgWordSeparator,
							element,
						)
					} else {
						result.push(element);
					}
				}
			} else {
				if (!element && !error) {
					console.warn("lr_format_selection_body: empty element in the beginning")
				}
				result.push(element);
			}
			if (error) {
				lastError = lr_meta.errorText(error);
				result.push(`\n(${lastError})`);
			}
			return result;
		}, []);
		if (descriptor.error) {
			const arrayError = lr_meta.errorText(descriptor.error);
			if (lastError !== arrayError) {
				formatted.push(`\n(${arrayError})`);
			}
		}
		return formatted;
	}
	const retval = [];
	if (selection != null && selection !== "") {
		retval.push(String(selection));
	}
	if (descriptor.error) {
		retval.push(`\n(${lr_meta.errorText(descriptor.error)})`);
	}
	return retval;
}

function lr_format_org_selection(frame) {
	try {
		return lr_do_format_org_selection(frame);
	} catch(ex) {
		console.error("lr_format_org_selection: error: %o", ex);
	}
	return [ "(!) Internal error in selection formatter" ];
}

function lr_do_format_org_selection(frame) {
	function* selectionVariants(meta) {
		for (const key of [
			"window.getSelection.range",
			"window.getSelection.text",
			"clickData.selectionText",
		]) {
			yield *meta.descriptors("selection", key);
		}
	}
	let selection;
	for (const descriptor of selectionVariants(frame)) {
		if (descriptor.value && descriptor.error == null) {
			selection = descriptor;
			break;
		}
	}
	if (!selection) {
		for (const descriptor of selectionVariants(frame)) {
			if (descriptor.value || descriptor.error != null) {
				selection = descriptor;
				break;
			}
		}
	}

	if (!selection) {
		return [];
	}
	return lr_org_tree.LrOrgQuote(null, ...lr_format_selection_body(selection));
}

function lr_format_org_frame(frame, options = {}) {
	const title = lr_format_org.preferredPageTitle(frame);
	let url = null;
	const properties = options.baseProperties && options.baseProperties.slice() || [];
	lrOrgCollectProperties(properties, frame);
	const {
		LrOrgDefinitionItem, LrOrgHeading, LrOrgSeparatorLine, LrOrgWordSeparator, LrOrgLink,
	} = lr_org_tree;
	const body = [];

	for (let variant of lr_format_org.urlVariants(frame) || []) {
		body.push(LrOrgDefinitionItem({ term: "URL" }, LrOrgLink({ href: variant.value })));
		if (url == null) {
			url = variant.value;
		}
	}
	for (const titleVariant of lr_sorted_title(frame)) {
		body.push(LrOrgDefinitionItem({ term: "title" }, titleVariant));
	}
	const dateProperties = new Set(["published_time", "modified_time"]);
	for (let property of ['author', 'published_time', 'modified_time', 'site_name']) {
		const variants = Array.from(frame.descriptors(property));
		for (const entry of variants) {
			try {
				if (
					property === 'site_name'
					&& entry.keys.some(x => x.endsWith(".twitter:site"))
					&& variants.length > 1
					&& entry.value[0] === "@"
				) {
					continue;
				}
				const value = dateProperties.has(property) ? lr_formatter.parseDate(entry.value) : entry.value;
				body.push(LrOrgDefinitionItem({ term: property }, value));
			} catch (ex) {
				console.error("lr_format_org_frame: ignoring error for: %o %o", entry, ex);
			}
		}
	}
	if (options.addReferrer && !options.separateReferrer) {
		body.push(...lr_format_org_referrer(frame));
	}
	const description = lr_format_org_description(frame);
	if (description) {
		body.push(LrOrgDefinitionItem({ term: "description" }, description));
	}
	if (lr_meta.firstValue(frame.descriptors("target")) !== "link") {
		// Link to particular part of the same page is not formatted as a link.
		body.push(...lr_format_org_link_text_properties(frame));
	}

	body.push(LrOrgSeparatorLine);
	if (!options.suppressSelection) {
		body.push(...lr_format_org_selection(frame));
		body.push(LrOrgSeparatorLine);
	}
	if (options.addReferrer && options.separateReferrer) {
		body.push(...lr_format_org_referrer(frame));
	}
	if (options.body) {
		body.push(LrOrgSeparatorLine, ...options.body);
	}
	return { title, url, tree: LrOrgHeading({ heading: title, properties }, ...body) };
}

// FIXME: add wrapper to catch exceptions
function lr_format_org_referrer(frame) {
	const result = [];
	for (let entry of frame.descriptors('referrer')) {
		if (!entry.value) {
			console.warn("lr_format_org_referrer: skipping due to missed href: %o", entry);
			continue;
		}
		result.push(lr_org_tree.LrOrgDefinitionItem(
			{ term: "referrer" }, lr_org_tree.LrOrgLink({ descriptor: entry })));
	}
	return result;
}

function lr_format_org_image(frameChain, target, baseProperties) {
	const meta = frameChain[0];

	if (target !== 'image' || (
		meta.get('srcUrl') == null && meta.get('imageAlt') == null
		&& meta.get('imageTitle') == null
	)) {
		console.error("No image captured"); // TODO report to error collector
		return;
	}

	const { LrOrgLink, LrOrgDefinitionItem } = lr_org_tree;
	let url;
	const properties = baseProperties.slice();
	for (const descr of lr_meta.errorsLast(meta.descriptors("srcUrl"))) {
		if (descr.error != null) {
			break;
		} else if (descr.value) {
			url = url || descr.value;
			properties.push(["URL_IMAGE", descr.value]);
		}
	}

	const description = [];
	for (const [property, name] of [["srcUrl", "image URL"], ["imageAlt", "alt"], ["imageTitle", "title"]]) {
		for (let v of meta.descriptors(property)) {
			const body = property === "srcUrl" ? LrOrgLink({ descriptor: v }) : v.value;
			description.push(LrOrgDefinitionItem({ term: name }, body));
		}
	}
	const title = lr_format_org.makeImageTitle(meta);
	const config = { title, url, properties, baseProperties, description };
	return lr_format_frame_chain_with_target(frameChain, target, config);
}

function* lr_format_org_link_text_properties(meta) {
	const { LrOrgDefinitionItem } = lr_org_tree;
	for (const [property, name] of [
		[ "linkText", "Link text" ],
		["linkTitle", "Link title"], ["linkHreflang", "Link language"],
		["linkType", "Link type"], ["linkDownload", "Link file hint"]]
	) {
		for (const variant of (meta.get(property) || [])) {
			yield LrOrgDefinitionItem({ term: name }, variant.value);
		}
	}
}

function lr_format_org_link (frameChain, target, baseProperties) {
	const meta = frameChain[0];
	const linkUrlVariants = meta.get("linkUrl");
	if (target !== 'link' || linkUrlVariants == null) {
		console.error("No link captured"); // TODO report to error collector
		return
	}

	const { LrOrgLink, LrOrgDefinitionItem, LrOrgWordSeparator } = lr_org_tree;

	const description = [];
	let url;
	for (const variant of linkUrlVariants) {
		if (!variant.value && !variant.error) {
			continue;
		}
		if (url == null) {
			url = variant.value;
		}
		description.push(LrOrgDefinitionItem({ term: "Link URL" }, LrOrgLink({ descriptor: variant })));
	}
	description.push(...lr_format_org_link_text_properties(meta));
	const title = lr_format_org.makeLinkTitle(meta);
	const config = { title, url, properties: baseProperties, baseProperties, description };
	return lr_format_frame_chain_with_target(frameChain, target, config);
}

function lr_format_frame_chain_with_target(frameChain, target, config) {
	const { title, url, description, properties, baseProperties } = config;
	const { LrOrgHeading, LrOrgSeparatorLine } = lr_org_tree;
	description.push(LrOrgSeparatorLine);
	description.push(...lr_format_org_selection(frameChain[0]));
	description.push(LrOrgSeparatorLine);
	if (frameChain.length > 1) {
		description.push("In the frame of the following page"); // TODO i18n
	} else {
		description.push("On the page"); // TODO i18n
	}
	description.push(LrOrgSeparatorLine);
	const sourceFrames = lr_format_org_frame_chain(frameChain, target, baseProperties);
	const tree = LrOrgHeading(
		{ heading: title, properties },
		...description,
		...sourceFrames,
	);
	return { title, url, tree };
}

function lr_format_org_frame_chain(frameChain, target, baseProperties) {
	return frameChain.map((frame, index, array) => lr_format_org_frame(
		frame, {
			suppressSelection: index === 0 && !!target,
			addReferrer: index === array.length - 1,
			separateReferrer: false,
			baseProperties,
		}
	).tree);
}

function lr_format_org_tab_frame_chain(object) {
	const type = object && object._type;
	if (type !== "TabFrameChain") {
		throw new TypeError(`lr_format_org_tab_frame_chain: type "${type}" !== "TabFrameChain"`);
	}
	const frameChain = object.elements;
	const baseProperties = [["DATE_ADDED", new Date()]];
	let result = null;
	const target = lr_meta.firstValue(frameChain[0].descriptors("target"));
	switch (target) {
		case "image":
			result = lr_format_org_image(frameChain, target, baseProperties);
			break;
		case "link":
			result = lr_format_org_link(frameChain, target, baseProperties);
			break;
	}
	if (!result) {
		const subframes = frameChain.slice(1).map(
			(frame, index, array) => lr_format_org_frame(
				frame, {
					suppressSelection: false,
					addReferrer: index === array.length - 1,
					separateReferrer: false,
					baseProperties,
				}
			).tree
		);
		result = lr_format_org_frame(frameChain[0], {
			suppressSelection: false,
			addReferrer: subframes.length === 0,
			separateReferrer: false,
			baseProperties,
			body: subframes,
		});
	}
	return result;
}

function lr_format_org_tab_group(object, executor) {
	const { _type, elements } = object || {};
	if (_type !== "TabGroup") {
		throw new TypeError(`lr_format_org_tab_group: type "${String(_type)}" !== "TabGroup"`);
	}
	if (!Array.isArray(elements)) {
		throw new TypeError('lr_format_org_tab_group: elements is not an Array');
	}

	const title = [ "Tab group", lr_org_buffer.LrOrgWordSeparator, new Date() ];
	const children = [];
	const errors = [];
	let formattedTabs = 0;
	for (const tab of elements) {
		try {
			const type = tab && tab._type;
			switch (type) {
				case "Text":
					children.push(lr_org_buffer.LrOrgSeparatorLine, ...tab.elements);
					break;
				case "TabFrameChain":
					children.push(
						lr_org_buffer.LrOrgSeparatorLine,
						executor.child(
							{ contextObject: tab, },
							lr_format_org_tab_frame_chain,
							tab
						).tree);
					++formattedTabs;
					break;
				default:
					throw new TypeError(`lr_format_org_tab_group: unknown element type ${String(type)}`);
			}
		} catch (ex) {
			errors.push(ex);
			console.error("lr_format_org_tab_group: continue despite error: %o", ex);
		}
	}
	executor.step(
		function checkForTabFormattingErrors(children, formattedTabs, errors, executor) {
			const failures = errors.length;
			if (!(formattedTabs > 0)) {
				const message = "No successfully formatted tabs";
				if (failures > 0) {
					throw new LrAggregateError(errors, message);
				} else {
					throw new Error(message);
				}
			}
			if (failures > 0) {
				children.unshift(`Formatting of ${failures} tabs failed`, lr_org_buffer.LrOrgSeparatorLine);
				executor.addError(new LrAggregateWarning(errors, "Formatting of some tabs failed"));
			}
		}, children, formattedTabs, errors);

	const tree = new lr_org_tree.LrOrgHeading({ heading: title }, ...children);
	return { title, tree };
}

Object.assign(lr_format_org, {
	format(object, options, executor) {
		if (!object) {
			throw new Error("Capture failed");
		}
		let handler;
		switch (object._type) {
			case "TabFrameChain":
				handler = lr_format_org_tab_frame_chain;
				break;
			case "TabGroup":
				handler = lr_format_org_tab_group;
				break;
		}
		if (!handler) {
			throw new TypeError(`lr_format_org: unsupported type "${object._type}"`);
		}
		const { url, title, tree } = executor.step(handler, object /*, executor*/);
		let body = executor.step(
			{ step: "serialize Org tree", },
			function orgBodyToText(tree, _executor) {
				// Avoid passing executor to `toText`
				return lr_org_tree.toText(tree);
			}, tree);
		const templateType = options && options.templateType;
		if (templateType === 'entry') {
			// It is a dirty hack. It should be responsibility of lr_org_buffer,
			// changes are not really small there.
			// Straightforward way is to add subtree capture type to org-protocol.el.
			body = body.replace(/^\* /, '');
		}
		return {
			url,
			title: lr_org_tree.toPlainText(title),
			body,
		};
	}
});
