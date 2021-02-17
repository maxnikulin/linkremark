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

var lr_test_format_org = lr_util.namespace("lr_test_format_org", lr_test_format_org, function(lr_test_format_org) {
	const cases_limitSimple = [
		[ [ "author", "title", "site" ], [ "author", "title", "site" ] ],
		[
			[ "author", "very long title", "site with very" ],
			[ "author", "very long title", "site with very long name as well" ],
		],
		[
			[ "Site with empty page title and the" ],
			[ null, null, "Site with empty page title and the author" ],
		],
		[
			[ "Only long author is specified on" ],
			[ "Only long author is specified on this page", "", "" ],
		],
		[
			[],
			[ null, "", null],
		],
		[
			[ "The page with no metadata and only" ],
			[ null, "The page with no metadata and only the title is specified", null ],
		],
		[
			[ "Author With A", "Title With a", "Even s" ],
			[
				"Author With A Lot Of Names",
				"Title With a Lot of Words",
				"Even site name is long",
			],
		]
	];

	var test_limitSimple = lr_test.parametrize(cases_limitSimple, function test_limitSimple(expectation, input) {
		const descriptors = [
			{ min: 6, target: 12, stiff: 1, flexThreshold: 12 },
			{ min: 6, target: 12, stiff: 1, flexThreshold: 12 },
			{ min: 6, target: 12, flexThreshold: 12 },
		];
		for (let i = 0; i < descriptors.length; ++i) {
			descriptors[i].value = input[i];
		}
		const result = lr_format_org.limitComponentsLength(descriptors).map(x => "" + x);
		lr_test.assertIterablesEq(expectation, result);
	});

	const cases_title = [
		{
			result: "MDN Web Docs",
			descriptors: [
				{ value: "MDN Web Docs", property: "title", key: "document.title" },
				{ value: "MDN Web Docs", property: "site_name", key: "meta.property.og:site_name" },
			],
		},
		{
			// It's a fake, real page does not have site_name. Author is fake as well.
			result: "Wiki User — String.prototype.indexOf() - JavaScript — MDN",
			descriptors: [
				{ property: "title", value: "String.prototype.indexOf() - JavaScript | MDN", key: "document.title" },
				{ property: "site_name", value: "MDN", key: "meta.name.site_name" },
				{ property: "author", value: "Wiki User", key: "meta.test.fake" },
			],
		},
		{
			result:
				"Excessively Long Author Name That… — " +
				"Title on this page is incredibly long as well to… — Site aut…",
			descriptors: [
				{
					property: "author", key: "meta.name.author",
					value: "Excessively Long Author Name That Does not Fit into Allowed Range",
				},
				{
					property: "title", key: "document.title",
					value: "Title on this page is incredibly long as well to cause its truncation",
				},
				{
					property: "site_name", key: "meta.property.og:site_name",
					value: "Site author believes that site name should be long and detailed",
				},
			],
		},
	];

	var test_title = lr_test.parametrize(cases_title, function test_title({result, descriptors}) {
		const meta = new LrMeta();
		for (const { property, ...other } of descriptors) {
			meta.addDescriptor(property, other);
		}
		lr_test.assertEq(result, lr_format_org.preferredPageTitle(meta));
	});

	function test_titleEmpty() {
		const meta = new LrMeta();
		const title = lr_format_org.preferredPageTitle(meta);
		lr_test.assertTrue(() => Array.isArray(title));
		lr_test.assertEq("Web page —", title[0]);
	}

	const cases_truncate = [
		[ 'very long title', 'very long title', 6, 15, 15 ],
		[ 'Abcdefghij', 'Abcdefghijklmn', 8, 10, 12 ],
		[ 'Abcdefghijklmn', 'Abcdefghijklmn', 8, 10, 15 ],
		[ 'Abcdefgh', 'Abcdefgh ijklmn', 8, 10, 12 ],
		[ 'Abcdefg hij', 'Abcdefg hij klmn', 6, 10, 14 ],
		[ 'Abcdefgh', 'Abcdefgh ijkl mn', 6, 10, 14 ],
		[ 'Ab defgh', 'Ab defgh.ijkl.mn', 6, 10, 14 ],
		[ '(b defgh)', '(b defgh)ijklmn', 6, 10, 14 ],
	];

	var test_truncate = lr_test.parametrize(cases_truncate, function test_truncate(expected, ...args) {
		lr_test.assertEq(expected, "" + lr_format_org.truncate(...args));
	});

	Object.assign(this, {
		cases_limitSimple,
		test_limitSimple,
		cases_title,
		test_title,
		cases_truncate,
		test_truncate,
	});
	lr_test.suites.push(this);
	return this;
});
