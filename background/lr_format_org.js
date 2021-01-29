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

var lr_url_src_weight = new Map([
	['link.canonical', 1000],
	['meta.property.og:url', 100],
	['clickData.srcUrl', 10],
]);

function lr_url_weight(url_src) {
	const weight = lr_url_src_weight.get(url_src);
	return weight != null ? weight : 1;
}

function lr_sorted_url(meta) {
	if (!meta) {
		return null;
	}
	const urlVariants = meta.get('url') || [];
	const weightedVariants = urlVariants.map(entry => ({
		value: entry.value, weight: entry.keys.map(lr_url_weight).reduce((a, b) => a + b, 0)
	}));
	weightedVariants.sort((a, b) => b.weight - a.weight);
	return weightedVariants.map(x => x.value);
}

function lr_preferred_url(frame) {
	const urlVariants = lr_sorted_url(frame);
	return urlVariants && urlVariants.length > 0 ? urlVariants[0] : null;
}

function lr_sorted_title(meta) {
	if (!meta) {
		return [];
	}
	const titleVariants = meta.get('title') || [];
	const valueVariants = titleVariants.map(entry => entry.value);
	valueVariants.sort((a, b) => b.length - b.length);
	return valueVariants;
}

function lr_preferred_title(meta) {
	// FIXME limit title length
	// TODO fallback to selection, description fragment of reasonable length
	const valueVariants = lr_sorted_title(meta);
	return valueVariants.length > 0 ? valueVariants[0] : null;
}

function lr_property_variants(meta, property) {
	if (!meta) {
		return null;
	}
	return meta.get(property) || [];
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
	const imageVariants = lr_property_variants(frame, 'image');
	if (imageVariants && imageVariants.length > 0) {
		for (let img of imageVariants) {
			result.push(["URL_IMAGE", img.value]);
		}
	}
	const modifiedVariants = lr_property_variants(frame, 'lastModified');
	if (modifiedVariants && modifiedVariants.length > 0) {
		for (let time of modifiedVariants) {
			result.push(["LAST_MODIFIED", time.value]);
		}
	}
	return result;
}

function lr_format_selection_body(selection) {
	if (selection == null || selection === "") {
		return [];
	} else if (Array.isArray(selection)) {
		const { LrOrgMarkup, LrOrgSeparatorLine, LrOrgWordSeparator } = lr_org_tree;
		return selection.reduce(function(result, element) {
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
				if (!element) {
					console.warn("lr_format_selection_body: empty element in the beginning")
				}
				result.push(element);
			}
			return result;
		}, []);
	}
	return [ "" + selection ];
}

function lr_format_org_selection(frame) {
	const selection = frame.get("selection", "window.getSelection") ||
		frame.get("selection", "clickData.selectionText");
	if (!selection) {
		return [];
	}
	return lr_org_tree.LrOrgQuote(null, ...lr_format_selection_body(selection));
}

function lr_format_org_frame(frame, options = {}) {
	const title = lr_preferred_title(frame);
	let url = null;
	const properties = options.baseProperties && options.baseProperties.slice() || [];
	lrOrgCollectProperties(properties, frame);
	const {
		LrOrgDefinitionItem, LrOrgHeading, LrOrgSeparatorLine, LrOrgWordSeparator, LrOrgLink,
	} = lr_org_tree;
	const body = [];
	for (let variant of lr_sorted_url(frame) || []) {
		body.push(LrOrgDefinitionItem({ term: "URL" }, LrOrgLink({ href: variant })));
		if (url == null) {
			url = variant;
		}
	}
	for (const titleVariant of lr_sorted_title(frame)) {
		body.push(LrOrgDefinitionItem({ term: "title" }, titleVariant));
	}
	for (let property of ['author', 'published_time', 'modified_time', 'site_name']) {
		const variants = lr_property_variants(frame, property);
		for (const entry of variants || []) {
			body.push(LrOrgDefinitionItem({ term: property }, entry.value));
		}
	}
	if (options.addReferrer && !options.separateReferrer) {
		body.push(...lr_format_org_referrer(frame));
	}
	const description = lr_format_org_description(frame);
	if (description) {
		body.push(LrOrgDefinitionItem({ term: "description" }, description));
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
	const heading = title || ( url ? LrOrgLink({ href: url }) : "No title" ); // TODO i18n
	return { title: title || url, url, tree: LrOrgHeading({ heading, properties }, ...body) };
}

// FIXME: add wrapper to catch exceptions
function lr_format_org_referrer(frame) {
	const referrerVariants = lr_property_variants(frame, 'referrer');
	const result = [];
	for (let entry of referrerVariants || []) {
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

	if (meta.get('srcUrl') == null && meta.get('imageAlt') == null && meta.get('imageTitle') == null) {
		console.error("No image captured"); // TODO report to error collector
		return;
	}

	const { LrOrgLink, LrOrgDefinitionItem } = lr_org_tree;
	const url = meta.getAnyValue('srcUrl');
	// FIXME limit text length
	const imgTitle = meta.getAnyValue('imageAlt') || meta.getAnyValue('imageTitle') || LrOrgLink({ href: url });
	const title = ["Image: ", imgTitle]; // TODO i18n
	const properties = baseProperties.slice();
	for (const url of lr_property_variants(meta, "srcUrl")) {
		properties.push(["URL_IMAGE", url.value]);
	}

	const description = [];
	for (const [property, name] of [["srcUrl", "image URL"], ["imageAlt", "alt"], ["imageTitle", "title"]]) {
		const variants = lr_property_variants(meta, property);
		for (let v of variants) {
			description.push(LrOrgDefinitionItem({ term: name }, LrOrgLink({ href: v.value })));
		}
	}
	const config = { title, url, properties, baseProperties, description };
	return lr_format_frame_chain_with_target(frameChain, target, config);
}

function lr_format_org_link (frameChain, target, baseProperties) {
	const meta = frameChain[0];
	const linkUrlVariants = meta.get("linkUrl");
	if (linkUrlVariants == null) {
		console.error("No link captured"); // TODO report to error collector
		return
	}

	const { LrOrgLink, LrOrgDefinitionItem, LrOrgWordSeparator } = lr_org_tree;

	const linkTextVariants = meta.get("linkText");
	const linkText0 = linkTextVariants && linkTextVariants[0].value;
	// TODO try selection text if it short enough
	// especially if it contains link text
	const title = ["Link:"]; // TODO i18n
	if (linkText0) {
		title.push(LrOrgWordSeparator, linkText0);
	}
	if (!(linkText0 && linkText0.length > 20)) {
		title.push(LrOrgWordSeparator, LrOrgLink({ href: linkUrlVariants[0].value }));
	}
	const description = [];
	let url;
	for (const variant of linkUrlVariants) {
		if (url == null) {
			url = variant.value;
		}
		description.push(LrOrgDefinitionItem({ term: "Link URL" }, LrOrgLink({ href: variant.value })));
	}
	for (const variant of (linkTextVariants || [])) {
		description.push(LrOrgDefinitionItem({ term: "Link text" }, variant.value));
	}
	for (const [property, name] of [
		["linkTitle", "Link title"], ["linkHreflang", "Link language"],
		["linkType", "Link type"], ["linkDownload", "Link file hint"]]
	) {
		for (const variant of (meta.get(property) || [])) {
			description.push(LrOrgDefinitionItem({ term: name }, vairant.value));
		}
	}
	const config = { title, url, properties: baseProperties, baseProperties, description };
	return lr_format_frame_chain_with_target(frameChain, target, config);
}

function lr_format_frame_chain_with_target(frameChain, target, config) {
	const { title, url, description, properties, baseProperties } = config;
	const { LrOrgHeading, LrOrgSeparatorLine, toText } = lr_org_tree;
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
	return { title: toText(title), url, tree };
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

function lr_format_org(frameChain, target) {
	if (!frameChain) {
		throw new Error("Capture failed");
	}
	const baseProperties = [["DATE_ADDED", new Date()]];
	let result = null;
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
	const { url, title, tree } = result;
	return {
		url,
		title: lr_util.replaceSpecial(title),
		body: lr_org_tree.toText(tree),
	};
}
