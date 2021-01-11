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

var lr_org_buffer = lr_util.namespace("lr_org_buffer", lr_org_buffer, function() {

	/**
	 * Special objects that could be pushed to org buffer besides strings
	 */

	/**
	 * Text with org markup that does not need escaping of some character sequences
	 */
	class LrOrgMarkupT {
		constructor(textContent) {
			this.textContent = textContent;
		};
	};

	function LrOrgMarkup(...args) {
		return new LrOrgMarkupT(...args);
	}

	function LrOrgStartLine() {
		return LrOrgStartLine;
	}

	function LrOrgSeparatorLine() {
		return LrOrgSeparatorLine;
	}

	function LrOrgWordSeparator() {
		return LrOrgWordSeparator;
	}

	/**
	 * DFA transition functions
	 */
	class LrOrgBufferState {
		initial(buffer, element) {
			console.assert(buffer.line.length === 0);
			console.assert(buffer.unsafeText.length === 0);
			if (typeof element === "string") {
				if (!element) {
					return this.initial;
				}
				buffer.pushStartOfLineText(element);
				return this.text;
			} else if (element instanceof LrOrgMarkupT) {
				buffer.line.push(buffer.indent(), element.textContent);
				return this.markup;
			} else if (element === LrOrgStartLine || element === LrOrgSeparatorLine) {
				return this.initial;
			}
			// LrOrgWordSeparator is ignored
		};

		text(buffer, element) {
			console.assert(buffer.unsafeText.length > 0);
			if (typeof element === "string") {
				if (element) {
					buffer.unsafeText.push(element);
				}
				return this.text;
			} else if (element instanceof LrOrgMarkupT) {
				buffer.flushUnsafeText(element.textContent);
				buffer.line.push(element.textContent);
				return this.markup;
			} else if (element === LrOrgWordSeparator) {
				return this.textWordSeparator;
			} else if (element === LrOrgStartLine || element === LrOrgSeparatorLine) {
				buffer.flushUnsafeText(null);
				buffer.flushLine();
				if (element === LrOrgSeparatorLine) {
					return this.separatorLine;
				} else {
					return this.startOfLine;
				}
			}
		};

		markup(buffer, element) {
			if (typeof element === "string") {
				if (!element) {
					return this.markup;
				}
				console.assert(buffer.unsafeText.length === 0,
					"there should be no text chunks in markup state");
				buffer.unsafeText.push(element);
				return this.text;
			} else if (element instanceof LrOrgMarkupT) {
				buffer.line.push(element.textContent);
				return this.markup;
			} else if (element === LrOrgWordSeparator) {
				return this.markupWordSeparator;
			} else if (element === LrOrgStartLine) {
				buffer.flushLine();
				return this.startOfLine;
			} else if (element === LrOrgSeparatorLine) {
				buffer.flushLine();
				return this.separatorLine;
			}
		};

		textWordSeparator(buffer, element) {
			console.assert(buffer.unsafeText.length > 0);
			if (typeof element === "string") {
				if (!element) {
					return this.textWordSeparator;
				}
				const hasSpace = /^\s/.test(element);
				if (!hasSpace && !/\s$/.test(buffer.unsafeText[buffer.unsafeText.length - 1])) {
					buffer.unsafeText.push(" ");
				}
				buffer.unsafeText.push(element);
				return this.text;
			} else if (element instanceof LrOrgMarkupT) {
				const hasSpace = /^\s/.test(element.textContent);
				if (!hasSpace && !/\s$/.test(buffer.unsafeText[buffer.unsafeText.length - 1])) {
					buffer.unsafeText.push(" ");
				}
				buffer.flushUnsafeText(element.textContent);
				buffer.line.push(element.textContent);
				return this.markup;
			} else if (element === LrOrgWordSeparator) {
				return this.textWordSeparator;
			} else if (element === LrOrgStartLine) {
				buffer.flushUnsafeText(null);
				buffer.flushLine();
				return this.startOfLine;
			} else if (element === LrOrgSeparatorLine) {
				buffer.flushUnsafeText(null);
				buffer.flushLine();
				return this.separatorLine;
			}
		};

		markupWordSeparator(buffer, element) {
			console.assert(buffer.unsafeText.length === 0);
			console.assert(buffer.line.length > 0);
			if (typeof element === "string") {
				if (!element) {
					return this.markupWordSeparator;
				}
				const hasSpace = /^\s/.test(element);
				if (!hasSpace && !/s$/.test(buffer.line[buffer.line.length - 1])) {
					buffer.unsafeText.push(" ");
				}
				buffer.unsafeText.push(element);
				return this.text;
			} else if (element instanceof LrOrgMarkupT) {
				const hasSpace = /^\s/.test(element.textContent);
				if (!hasSpace && !/\s$/.test(buffer.line[buffer.line.length - 1])) {
					buffer.line.push(" ");
				}
				buffer.line.push(element.textContent);
				return this.markup;
			} else if (element === LrOrgWordSeparator) {
				return this.markupWordSeparator;
			} else if (element === LrOrgStartLine) {
				buffer.flushLine();
				return this.startOfLine;
			} else if (element === LrOrgSeparatorLine) {
				buffer.flushLine();
				return this.separatorLine;
			}
		};

		startOfLine(buffer, element) {
			console.assert(buffer.unsafeText.length === 0);
			console.assert(buffer.line.length === 0);
			if (typeof element === "string") {
				if (!element) {
					return this.separatorLine;
				}
				buffer.pushStartOfLineText(element);
				return this.text;
			} else if (element instanceof LrOrgMarkupT) {
				buffer.line.push(buffer.indent(), element.textContent);
				return this.markup;
			} else if (element === LrOrgStartLine) {
				return this.startOfLine;
			} else if (element === LrOrgSeparatorLine) {
				return this.separatorLine;
			}
			// LrOrgWordSeparator is ignored
		};

		separatorLine(buffer, element) {
			console.assert(buffer.unsafeText.length === 0);
			console.assert(buffer.line.length === 0);
			if (typeof element === "string") {
				if (!element) {
					return this.separatorLine;
				}
				buffer.line.push("");
				buffer.flushLine();
				buffer.pushStartOfLineText(element);
				return this.text;
			} else if (element instanceof LrOrgMarkupT) {
				buffer.line.push("");
				buffer.flushLine();
				buffer.line.push(buffer.indent(), element.textContent);
				return this.markup;
			} else if (element === LrOrgStartLine || element === LrOrgSeparatorLine) {
				return this.separatorLine;
			}
			// LrOrgWordSeparator is ignored
		};
	}

	class LrOrgBuffer {
		constructor() {
			this.out = [];
			this.line = [];
			this.unsafeText = [];
			this.formatterState = {
				headingLevel: 0,
				textIndent: 0,
				depth: 0,
			};
			this.stateTranstions = new LrOrgBufferState();
			this.outputState = this.stateTranstions.initial;
		};
		indent() {
			return " ".repeat(this.formatterState.textIndent);
		};
		push(...args) {
			for (const element of args) {
				if (typeof element === "string") {
					let newlinesNormalized =
						element.replace(/[^\S\n]*(\n?)\s*\n/g, "$1\n");
					let first = true;
					for (const line of newlinesNormalized.split("\n")) {
						if (first) {
							first = false;
						} else {
							this.pushSingle(LrOrgStartLine);
						}
						this.pushSingle(line);
					}
				} else if (lr_util.isDate(element)) {
					this.pushSingle(LrOrgMarkup(orgFormatDate(element)));
				} else {
					this.pushSingle(element);
				}
			}
		};
		pushSingle(element) {
			const oldState = this.outputState;
			this.outputState = this.outputState.call(this.stateTranstions, this, element);
			if (this.outputState === undefined) {
				console.warn("LrOrgBuffer: transition from %s with %o is undefined",
					oldState.name, element);
				this.outputState = oldState;
			}
		};
		pushStartOfLineText(text) {
			this.unsafeText.push(this.indent(), text.replace(/^([^\n\S]{0,8})[^\n\S]*/, "$1"));
		};

		flushUnsafeText(next) {
			console.assert(this.unsafeText.length > 0);
			let line = this.unsafeText.join("");
			if (!next) {
				line = line.replace(/\s*$/, "");
			}
			if (this.line.length === 0) {
				if (/\s*(?:#\+|:\w)/.test(line) || (this.formatterState.textIndent === 0 && /^\*+\s/.test(line))) {
					line = ',' + line
				}
			} else if (/\]$/.test(this.line[this.line.length - 1])) {
				line = "\u200B" + line;
			}
			if (next && next[0] === '[' && /\[$/.test(line)) {
				line += "\u200B";
			}
			this.line.push(line.replace(/\[\[/g, "[\u200B[").replace(/\]\]/g, "]\u200B]"));
			this.unsafeText.splice(0, this.unsafeText.length);
			return;
		};

		flushLine() {
			this.out.push(this.line.join(""));
			this.line.splice(0, this.line.length);
		};

		flush() {
			this.pushSingle(LrOrgStartLine);
		};
	}

	Object.assign(this, {
		LrOrgStartLine, LrOrgSeparatorLine, LrOrgWordSeparator, LrOrgMarkup,
		LrOrgBuffer, LrOrgBufferState,
	});

	return this;
});
