
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

var lr_test_org_tree = lr_util.namespace(lr_test_org_tree, function lr_test_org_tree() {
	var lr_test_org_tree = this;
	const {	LrOrgStartLine, LrOrgSeparatorLine, LrOrgWordSeparator, LrOrgMarkup, }
		= lr_org_buffer;

	const {
		LrOrgDefinitionItem, LrOrgHeading, LrOrgLink, toText
	} = lr_org_tree;

	this.simpleCases = [
		[
			() => "[[a]]",
			"[\u200B[a]\u200B]",
		], [
			() => [ "[test]", " after bracket" ],
			"[test] after bracket",
			"No stray zero-width space to suppress links-like markup",
		], [
			() => [ "before bracket ", "[test]" ],
			"before bracket [test]",
			"No stray zero-width space to suppress links-like markup",
		], [
			() => [ "[[test]", "] not a link" ],
			"[\u200B[test]\u200B] not a link",
		], [
			() => [ "Not a link [", "[test]]" ],
			"Not a link [\u200B[test]\u200B]",
		], [
			() => [ LrOrgMarkup("[markup]"), " after markup" ],
			"[markup] after markup",
			"No stray zero-width space to suppress links-like markup",
		], [
			() => [ "Before markup", LrOrgMarkup("[markup]") ],
			"Before markup[markup]",
			"No stray zero-width space to suppress links-like markup",
		], [
			() => LrOrgLink({ href: "https://h-o.st/pa-th.html"}),
			"[[https://h-o.st/pa-th.html]]",
		], [
			() => LrOrgLink({ href: "https://ho.st/page#hash"}, "Description"),
			"[[https://ho.st/page#hash][Description]]",
		],
	];

	this.test_simple = lr_test.parametrize(
		this.simpleCases,
		function test_simple(treeBuilder, expectation) {
			const text = toText(treeBuilder()).trim();
			lr_test.assertEq(expectation, text);
		});

	this.test_heading = function() {
		const heading = LrOrgHeading(
			{ heading: "Header" },
			"Some text"
		);
		const text = toText(heading);
		lr_test.assertEq(text.trim(), "* Header\n\nSome text");
	};

	this.test_nestedHeadings = function() {
		const tree = LrOrgHeading(
			{ heading: "Chapter" },
			"Introduction",
			LrOrgHeading(
				{ heading: "Section" },
				"Paragraph\ntext",
			),
		);
		const text = toText(tree).trim();
		lr_test.assertEq(text, "* Chapter\n\nIntroduction\n\n** Section\n\nParagraph\ntext");
	};

	this.test_shortDefinitionItem = function() {
		const tree = LrOrgHeading(
			{ heading: "Head" },
			LrOrgDefinitionItem({ term: "an" }, "explanation   \n    \nof\nthe term"),
		);
		const text = toText(tree).trim();
		lr_test.assertEq(text,
`* Head

- an :: explanation

  of
  the term`);
	};

	this.test_longDefinitionItem = function() {
		const tree = LrOrgHeading(
			{ heading: "Head" },
			LrOrgDefinitionItem({ term: "something\nreally\n\n  long" }, "explanation   \n    \nof\nthe term"),
		);
		const text = toText(tree).trim();
		lr_test.assertEq(text,
`* Head

- something really long :: explanation

  of
  the term`);
	};

	this.test_headingPropertied = function() {
		const properties = [
			["IMAGE_URL", "http://ho.st/img1.png"],
			["IMAGE_URL", "http://te.st/img2.jpg"],
			["CUSTOM_ID", "test_heading"],
		];
		const tree = LrOrgHeading(
			{ heading: "Head", properties },
			"Some text.",
		);
		const text = toText(tree).trim();
		lr_test.assertEq(text,
`* Head
:PROPERTIES:
:IMAGE_URL: http://ho.st/img1.png
:IMAGE_URL+: http://te.st/img2.jpg
:CUSTOM_ID: test_heading
:END:

Some text.`);
	};

	this.test_headingWithLink = function() {
		const tree = LrOrgHeading(
			{ heading: "Head" },
			LrOrgDefinitionItem(
				{ term: "URL" },
				LrOrgLink({ href: "http://te.st/dir?b-=&a=-" }),
			),
		);
		const text = toText(tree).trim();
		lr_test.assertEq(text,
`* Head

- URL :: [[http://te.st/dir?b%2D=&a=%2D][http://te.st/dir?b-=&a=-]]`);
	};

	this.test_date = function() {
		const text = toText(new Date(2020, 1-1, 2, 3, 4, 5, 6)).trim();
		lr_test.assertTrue(() => /^\[2020-01-02 \p{Letter}+ 03:04\]$/u.test(text), `actual: "${text}"`);
	};

	this.test_nestedList = function() {
		const { LrOrgListItem } = lr_org_tree;
		const formatted = toText(
			LrOrgListItem({ marker: '+' },
				'First', LrOrgStartLine,
				LrOrgListItem(null, 'Nested 1'),
				LrOrgListItem(null, 'Nested 2'),
			),
			LrOrgListItem({ marker: '+' },
				'Second'),
		);
		const expected = // Next line is shifted by 1 character due to the backtick.
`+ First
  - Nested 1
  - Nested 2
+ Second`;
		lr_test.assertEq(expected, formatted);
	}

	lr_test.suites.push(this);
	return this;
});
