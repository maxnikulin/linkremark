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

var lr_org_tree = lr_util.namespace("lr_org_tree", lr_org_tree, function() {
	const {
		LrOrgStartLine, LrOrgSeparatorLine, LrOrgWordSeparator, LrOrgMarkup,
	} = lr_org_buffer;

	function toText(...elements) {
		const buffer = new lr_org_buffer.LrOrgBuffer();
		toOrgRecursive(buffer, elements);
		buffer.flush();
		return lr_util.replaceSpecial(buffer.out.join("\n"));
	};

	function toOrgRecursive(buffer, element) {
		if (buffer.formatterState.depth > 128) {
			const prototype = Object.getPrototypeOf(element);
			console.error(
				"lr_org_tree.toOrgRecursive: recursion limit reached %s %o",
				prototype && prototype.constructor && prototype.constructor.name,
				element
			);
			return;
		}
		++buffer.formatterState.depth;
		try {
			if (element == null) {
				;
			} else if (element.toOrg) {
				toOrgRecursive(buffer, element.toOrg(buffer));
			} else if (typeof element === 'object' && Symbol.iterator in element) {
				for (const item of element) {
					toOrgRecursive(buffer, item);
				}
			} else {
				buffer.push(element);
			}
		} finally {
			--buffer.formatterState.depth;
		}
	};

	class LrOrgContainerT {
		constructor(_attrs, ...children) {
			this.children = children;
		};

		append(...children) {
			this.children.push(...children);
		};

		toOrg(buffer) {
			return toOrgRecursive(buffer, this.children);
		};
	}

	function LrOrgContainer(...args) {
		return new LrOrgContainerT(...args);
	}

	class LrOrgNobreakT extends LrOrgContainerT {
		toOrg(buffer) {
			const mixin = {
				push(element) {
					let replacement = element;
					if (typeof element === "string") {
						replacement = element.replace(/\s*\n\s*/g, " ");
					} else if (element === LrOrgStartLine) {
						this.ignore("LrOrgStartLine");
						replacement = LrOrgWordSeparator;
					} else if (element === LrOrgSeparatorLine) {
						this.ignore("LrOrgSeparatorLine");
						replacement = LrOrgWordSeparator;
					}
					return Object.getPrototypeOf(this).push(replacement);
				},
				ignore(what) {
					console.warn("LrOrgNobreak: warning: ignore " + what);
				},
			};

			const filteringBuffer = Object.create(buffer);
			Object.assign(filteringBuffer, mixin);
			return super.toOrg(filteringBuffer);
		};
	}

	function LrOrgNobreak(...args) {
		return new LrOrgNobreakT(...args);
	}

	class LrOrgStateScopeT extends LrOrgContainerT {
		constructor({state, ...attrs}, ...children) {
			super(attrs, ...children);
			this.state = state;
		};
		toOrg(buffer) {
			const savedState = buffer.formatterState;
			try {
				buffer.formatterState = Object.create(buffer.formatterState);
				for (const [name, value] of Object.entries(this.state || {})) {
					buffer.formatterState[name] += value;
				}
				return super.toOrg(buffer);
			} finally {
				buffer.formatterState = savedState;
			}
		};
	}

	function LrOrgStateScope(...args) {
		return new LrOrgStateScopeT(...args);
	}

	class LrOrgHeadingMarker {
		toOrg(buffer) {
			return [
				LrOrgMarkup("*".repeat(buffer.formatterState.headingLevel)),
				LrOrgWordSeparator,
			];
		};
	}

	function LrOrgListItem(attr, ...children) {
		const marker = (attr.marker || '-');
		return [
			LrOrgStartLine,
			LrOrgMarkup(marker), LrOrgWordSeparator,
			LrOrgStateScope({ state: { textIndent: Math.min(8, attr.marker.length + 1) } },
				...children
			),
			LrOrgStartLine,
		];
	}

	function LrOrgDefinitionItem({ term }, ...children) {
		term = ("" + term).trim();
		return [
			LrOrgStartLine,
			LrOrgMarkup("-"), LrOrgWordSeparator,
			LrOrgNobreak(null, term),
			LrOrgWordSeparator, LrOrgMarkup("::"), LrOrgWordSeparator,
			LrOrgStateScope({ state: { textIndent: Math.min(16, term.length + 6) } },
				...children
			),
			LrOrgStartLine,
		];
	}

	function LrOrgHeading({heading, properties}, ...children) {
		return [
			LrOrgSeparatorLine,
			LrOrgStateScope(
				{ state: { headingLevel: 1 } },
				LrOrgNobreak(null, new LrOrgHeadingMarker(), heading),
				LrOrgStateScope(
					{ state: { textIndent: 2 } },
					LrOrgPropertiesDrawer({ properties }),
				),
				LrOrgSeparatorLine,
				...children,
			),
			LrOrgSeparatorLine,
		];
	}

	function LrOrgDrawer({name}, ...children) {
		if (children.length === 0) {
			return [];
		}
		return [
			LrOrgStartLine,
			LrOrgMarkup(`:${name}:`),
			LrOrgStartLine,
			...children,
			LrOrgStartLine,
			LrOrgMarkup(":END:"),
			LrOrgStartLine,
		];
	}

	function LrOrgPropertiesDrawer({properties}) {
		if (properties == null) {
			return;
		}
		const seen = new Set();
		const children = [];
		for (let [prop, ...value] of properties) {
			const plus = seen.has(prop) ? "+" : "";
			children.push(
				LrOrgMarkup(":"), LrOrgNobreak(null, prop), LrOrgMarkup(plus + ":"),
				LrOrgWordSeparator,
				LrOrgNobreak(null, ...value),
				LrOrgStartLine,
			)
			seen.add(prop);
		}
		return LrOrgDrawer({ name: "PROPERTIES" }, children);
	}

	class LrOrgLinkT {
		constructor({ href, descriptor, lengthLimit }, ...description) {
			this.href = href;
			this.descriptor = descriptor;
			this.lengthLimit = lengthLimit;
			this.description = description;
		}
		toOrg(buffer) {
			let { href, descriptor, lengthLimit, description } = this;
			href = href || (descriptor && descriptor.value);
			if (!href) {
				console.warn("LrOrgLink: no href");
				return description;
			}
			if (descriptor && descriptor.error) {
				const errorText = lr_meta.errorText(descriptor.error);
				return [ `(${errorText}!)`, LrOrgWordSeparator, href, LrOrgWordSeparator, ...description ];
			}
			/* Sometimes pages have invalid URLs e.g. due to errors in web applications */
			try {
				const safeUrl = lr_org_buffer.safeUrl(href);
				if (description.length === 0) {
					const readableUrl = lr_org_buffer.readableUrl(href, lengthLimit);
					if (readableUrl === safeUrl) {
							return LrOrgNobreak(null, LrOrgMarkup(`[[${safeUrl}]]`));
					} else {
						return LrOrgNobreak(
							null, LrOrgMarkup(`[[${safeUrl}][${readableUrl}]]`));
					}
				} else {
					return LrOrgNobreak(
						null,
						LrOrgMarkup(`[[${safeUrl}][`),
						...description,
						LrOrgMarkup("]]"),
					);
				}
			} catch (ex) {
				console.error(ex);
				if (href && href.substring && lengthLimit) {
					href = href.substring(lengthLimit - 4);
				}
				return LrOrgNobreak(
					null,
					[ "(!)", LrOrgWordSeparator, href, LrOrgWordSeparator, ...description ]);
			}
		}
	}

	function LrOrgLink(attrs, ...children) {
		return new LrOrgLinkT(attrs, ...children);
	}

	function LrOrgQuote(_attrs, ...children) {
		return [
			LrOrgStartLine,
			LrOrgMarkup("#+begin_quote"),
			LrOrgStartLine,
			...children,
			LrOrgStartLine,
			LrOrgMarkup("#+end_quote"),
			LrOrgStartLine,
		];
	}

	/*
	 * Re-export some stuff from lr_org_buffer
	 */
	Object.assign(this, {
		LrOrgMarkup,
		LrOrgSeparatorLine,
		LrOrgStartLine,
		LrOrgWordSeparator,
	});

	Object.assign(this, {
		LrOrgContainer,
		LrOrgDefinitionItem,
		LrOrgDrawer,
		LrOrgHeading,
		LrOrgLink,
		LrOrgListItem,
		LrOrgNobreak,
		LrOrgPropertiesDrawer,
		LrOrgQuote,
		LrOrgStateScope,
		toText,
		internal: {
			LrOrgContainerT,
			LrOrgHeadingMarker,
			LrOrgNobreakT,
			LrOrgStateScopeT,
			toOrgRecursive,
		},
	});

	return this;
});
