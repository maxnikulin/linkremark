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

var lr_test_microdata = lr_util.namespace("lr_test_microdata", lr_test_microdata, function lr_test_microdata() {
	function metaValues(meta, field) {
		const valueObjects = meta.get(field);
		return valueObjects && valueObjects.map(o => o.value);
	}

	this.test_simpleItemprop = function() {
		const meta = new LrMeta();
		lr_meta.mergeMicrodata({ microdata: { result: {
			datePublished: [ "2001-02-03T03:04:05", "2019-11-28T22:57:56Z" ],
		}}}, meta);
		lr_test.assertEq(
			new Set([ "2001-02-03T03:04:05", "2019-11-28T22:57:56Z" ]),
			metaValues(meta, "published_time")
		);
	};

	this.test_typed = function() {
		const meta = new LrMeta();
		lr_meta.mergeMicrodata({ microdata: { result: {
			"@context": "http://schema.org",
			"@type": "Article",
			datePublished: "2019-11-28T22:57:56Z",
			"author": {
				"@type": "Person",
				"name": "Tom Soyer"
			},
		}}}, meta);
		lr_test.assertEq(
			new Set([ "2019-11-28T22:57:56Z" ]),
			metaValues(meta, "published_time")
		);
		lr_test.assertEq(
			new Set([ "Tom Soyer" ]),
			metaValues(meta, "author")
		);
	};

	this.test_mixed = function() {
		const meta = new LrMeta();
		lr_meta.mergeMicrodata({ microdata: { result: {
			datePublished: [ "2001-02-03T03:04:05", "2019-11-28T22:57:56Z" ],
			"@unnamed": {
				"@context": "http://schema.org",
				"@type": "Article",
				"author": {
					"@type": "Person",
					"name": "Tom Soyer"
				},
			}
		}}}, meta);

		lr_test.assertEq(
			new Set([ "2001-02-03T03:04:05", "2019-11-28T22:57:56Z" ]),
			metaValues(meta, "published_time")
		);
		lr_test.assertEq(
			new Set([ "Tom Soyer" ]),
			metaValues(meta, "author")
		);
	};
	lr_test.suites.push(this);
	return this;
});
