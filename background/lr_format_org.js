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

var lr_org = lr_util.namespace("lr_org", lr_org, function() {
	/**
	 * Force percent-encoding for characters considered safe by `encodeURIComponent`
	 *
	 * Warning: only single-byte characters are supported.
	 */
	this.encodeByte = function(codeStr) {
		return '%' + codeStr.codePointAt(0).toString(16).toUpperCase().padStart(2, '0')
	};
	/**
	 * Collected URLs are already in percent encoding.
	 *
	 * Formally accordingly to info '(org)Link format'
	 * https://orgmode.org/manual/Link-Format.html
	 * only brackets and backslash before brackets should be escaped with
	 * backslash. Really there is at least the following issue
	 * https://lists.gnu.org/archive/html/emacs-orgmode/2020-12/msg00706.html
	 * "Bug: Tildes in URL impact visible link text"
	 * 
	 * The problem is that parameter names and values could contain pre or post
	 * characters from org-emphasis-regexp-components.
	 * I hope, excessive percent encoding is less harm.
	 *
	 * Dashes in http://t-e.st/dash-path#dash-anchor should be preserved,
	 * but they should be escaped in http://te.st/dir?b-=&a=- to avoid
	 * spurious unveiling of verbatim-like part.
	 */
	this.safeUrlComponent = function(url) {
		/*
		 * :;,? could not appear in pathname, search or fragment
		 * _ (underline) is likely used too often and unlike ~= does not cause problem.
		 */
		return url.replace(/[\\\]\[(){}!]/g, this.encodeByte)
			.replace(/([*=~+])([-.])/g, (match, p1, p2) => p1 + this.encodeByte(p2))
			.replace(/(-)([*=~+])/g, (match, p1, p2) => this.encodeByte(p1) + p2);
	};

	/**
	 * Square brackets however could be a part of IPv6 address http://[::1]/
	 * that org 9.1 could not handle.
	 */
	this.safeUrlHost = function(hostname) {
		return hostname.replace(/\\(?:[\[\]]|$)/g, "\\$&").replace(/[\[\]]/g, "\\$&");
	};

	this.safeUrl = function(url) {
		url = new URL(url);
		// pathname could be replaced by the value with additional percent encoding,
		// but backslashes could not be added to hostname.
		return [
			url.protocol,
			url.hostname || url.protocol === "file:" ? "//" : "",
			this.safeUrlComponent(url.username),
			url.password ? ":" : "",
			this.safeUrlComponent(url.password),
			url.username || url.password ? "@" : "",
			this.safeUrlHost(url.hostname),
			url.port ? ":" : "",
			url.port,
			this.safeUrlComponent(url.pathname),
			this.safeUrlComponent(url.search),
			this.safeUrlComponent(url.hash),
		].join("");
	};

	/**
	 * Avoid percent encoding for Unicode characters.
	 * Remove newlines and repeating spaces.
	 *
	 * TODO punycode.js for hostname
	 */
	this.readableUrl = function(url) {
		if (!url) {
			return url;
		}
		let result = "" + url;
		try {
			result = decodeURI(url);
		} catch (ex) {
			console.warn("lr_org.readableUrl %o %o", url, ex);
		}
		return this.safeLinkDescription(result);
	};

	/**
	 * Org mode 9.1 does not allow brackets in link text.
	 * 9.3 just suggests to add zero width space between "]]".
	 */
	this.safeLinkDescription = function(description) {
		if (!description) {
			return description;
		}
		return ("" + description).replace(/\s+/g, " ").replace(/(])(]|$)/g, "$1\u200B$2");
	};
	return this;
});

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

function lr_preferred_title(meta) {
	if (!meta) {
		return null;
	}
	const titleVariants = meta.get('title') || [];
	const valueVariants = titleVariants.map(entry => entry.value);
	valueVariants.sort((a, b) => b.length - b.length);
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

function lr_format_org_properties(properties, out) {
	if (!(properties.length > 0)) {
		return;
	}
	out.push("  :PROPERTIES:");
	const propSet = new Set();
	for (let [prop, value] of properties) {
		const plus = propSet.has(prop) ? "+" : "";
		propSet.add(prop);
		out.push(`  :${prop}${plus}: ${value}`);
	}
	out.push("  :END:");
	return out;
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
		return selection.reduce(function(result, element) {
			if (result.array.length > 0) {
				if (element === "") {
					result.array.push("\n...\n");
					result.afterSeparator = true;
				} else {
					if (!result.afterSeparator) {
						const last = result.array.length - 1;
						result.array[last] += " … " + element;
					} else {
						result.afterSeparator = false;
						result.array.push(element);
					}
				}
			} else {
				if (!element) {
					console.warn("lr_format_selection_body: empty element in the beginning")
				}
				result.array.push(element);
			}
			return result;
		}, { array: [], afterSeparator: false }).array;
	}
	return [ "" + selection ];
}

function lr_format_org_selection(frame) {
	const selection = frame.get("selection", "window.getSelection") ||
		frame.get("selection", "clickData.selectionText");
	if (!selection) {
		return [];
	}
	const out = [];
	out.push('\n#+begin_quote');
	out.push(...lr_format_selection_body(selection));
	out.push('#+end_quote');
	return out;
}

function lr_format_org_frame(frame, options = {}) {
	const out = [];
	for (let url of lr_sorted_url(frame) || []) {
		try {
			out.push(`- URL :: ${orgLink(url)}`);
		} catch (ex) {
			// FIXME report to preview page
			console.error("lr_format_org_frame: invalid URL %s: %o", url, ex);
		}
	}
	const title = lr_preferred_title(frame);
	if (title) {
		out.push(`- title :: ${title}`);
	}
	for (let property of ['author', 'published_time', 'modified_time']) {
		const variants = lr_property_variants(frame, property);
		for (const entry of variants || []) {
			out.push(`- ${property} :: ${entry.value}`);
		}
	}
	const description = lr_format_org_description(frame);
	if (options.addReferrer && !options.separateReferrer) {
		out.push(...lr_format_org_referrer(frame));
	}
	if (description) {
		out.push(`- description :: ${description}`);
	}
	if (!options.suppressSelection) {
		out.push(...lr_format_org_selection(frame));
	}
	if (options.addReferrer && options.separateReferrer) {
		out.push(...lr_format_org_referrer(frame, true));
	}
	return out.join("\n");
}

function lr_format_org_referrer(frame, separate = false) {
	const referrerVariants = lr_property_variants(frame, 'referrer');
	const result = separate ? [""] : [];
	for (let entry of referrerVariants || []) {
		result.push(`- referrer :: ${orgLink(entry.value)}`);
	}
	return result;
}

/*
 * It is better to avoid control characters since they
 * could be accidentally pasted into terminal without proper protection.
 * https://flask.palletsprojects.com/en/1.1.x/security/#copy-paste-to-terminal
 * Copy/Paste to Terminal (in Security Considerations)
 * https://security.stackexchange.com/questions/39118/how-can-i-protect-myself-from-this-kind-of-clipboard-abuse
 * How can I protect myself from this kind of clipboard abuse?
 */
function lr_replace_special_characters(text, platformInfo) {
	// 1. Replace TAB with 8 spaces to avoid accidental activation of completion
	//    if pasted to bash (dubious).
	// 2. Newlines \r and \n should be normalized.
	//    Hope new macs uses "\n", not "\r".
	// 3. Other control characters should be replaced.
	//    U+FFFD REPLACEMENT CHARACTER
	//    used to replace an unknown, unrecognized or unrepresentable character
	const nl = platformInfo.os !== "win" ? "\n" : "\r\n";
	return text.replace(/\t/g, '        ').
		replace(/\r\n|\r|\n/g, nl).
		replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "\uFFFD");
}

function lr_format_org(frameChain, target, platformInfo) {
	if (!frameChain) {
		throw new Error("Capture failed"); // FIXME
	}

	var out = [];
	const properties = frameChain.reduce(lrOrgCollectProperties, [["DATE_ADDED", orgFormatDate(new Date())]]);
	lr_format_org_properties(properties, out);
	out.push("");

	let title, url;
	const meta = frameChain[0];
	let hasTarget = false;
	switch (target) {
		case "image":
			if (meta.get('srcUrl') == null && meta.get('imageAlt') == null && meta.get('imageTitle') == null) {
				throw new Error("No image captured");
			}
			const imgTitle = meta.getAnyValue('imageAlt') || meta.getAnyValue('imageTitle') || orgLink(meta.getAnyValue('srcUrl'));
			title = `Image: ${imgTitle}`;
			for (const [property, name] of [["srcUrl", "image URL"], ["imageAlt", "alt"], ["imageTitle", "title"]]) {
				const variants = lr_property_variants(frameChain[0], property);
				for (let v of variants) {
					out.push(`- ${name} :: ${orgLink(v.value)}`);
					if (url == null) {
						url = v.value;
					}
				}
			}
			hasTarget = true;
			break;
		case "link":
			const linkUrlVariants = meta.get("linkUrl");
			if (linkUrlVariants == null) {
				throw new Error("No linkUrl captured");
			}
			const linkTextVariants = meta.get("linkText");
			const linkText0 = linkTextVariants && linkTextVariants[0].value;
			// TODO try selection text if it short enough
			// especially if it contains link text
			const linkTitleComponents = ["Link:"];
			if (linkText0) {
				linkTitleComponents.push(linkText0);
			}
			if (!(linkText0 && linkText0.length > 20)) {
				linkTitleComponents.push(orgLink(linkUrlVariants[0].value));
			}
			title = linkTitleComponents.join(" ");
			for (const variant of linkUrlVariants) {
				if (url == null) {
					url = variant.value;
				}
				out.push(`- Link URL :: ${orgLink(variant.value)}`);
			}
			for (const variant of (linkTextVariants || [])) {
				out.push(`- Link text :: ${variant.value}`);
			}
			for (const [property, name] of [
				["linkTitle", "Link title"], ["linkHreflang", "Link language"],
				["linkType", "Link type"], ["linkDownload", "Link file hint"]]
			) {
				for (const variant of (meta.get(property) || [])) {
					out.push(`- ${name} :: ${vairant.value}`);
				}
			}
			hasTarget = true;
			break;
		default:
			url = lr_preferred_url(frameChain[0]);
			title = lr_preferred_title(frameChain[0]) || url;
	}

	if (hasTarget) {
		out.push(...lr_format_org_selection(meta));
		out.push("\nOn the page\n");
	}

	out.push(frameChain.map((frame, index, array) => lr_format_org_frame(
		frame, {
			suppressSelection: index === 0 && hasTarget,
			addReferrer: index === array.length - 1,
			separateReferrer: array.length > 1,
		}
	)).join('\n\nSubframe of\n\n'));
	return {
		url,
		title: lr_replace_special_characters(title, platformInfo),
		body: lr_replace_special_characters(out.join("\n"), platformInfo),
	};
}

var orgFormatDate = function(d) {
	function z2(num) {
		return ("" + num).padStart(2, "0");
	}
	const weekday = d.toLocaleString(navigator.language, {weekday: "short"})
		.replace(/^(\p{Letter})/u, x => x.toUpperCase());
	return (`[${d.getFullYear()}-${z2(1 + d.getMonth())}-${z2(d.getDate())}`
		+ ` ${weekday} ${z2(d.getHours())}:${z2(d.getMinutes())}]`);
};

function orgLink(url, title) {
	if (url) {
		// FIXME handle exception in the case of invalid URL
		const safeUrl = lr_org.safeUrl(url);
		if (title) {
			const description = lr_org.safeLinkDescription(title);
			return `[[${safeUrl}][${description}]]`;
		} else {
			const readableUrl = lr_org.readableUrl(url);
			return safeUrl === readableUrl ? `[[${safeUrl}]]` : `[[${safeUrl}][${readableUrl}]]`;
		}
	} else {
		if (title) {
			return title;
		} else {
			return "";
		}
	}
}
