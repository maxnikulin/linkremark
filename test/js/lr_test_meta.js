
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

var lr_test_meta = lr_util.namespace(lr_test_meta, function lr_test_meta() {
	var lr_test_meta = this;

	const cases_matchDOI = [
		[
			{
				value: "10.0.1/just-doi",
				key: "meta.name.doi",
			},
			"doi:10.0.1/just-doi", "Raw DOI"
		],
		[
			{
				value: "https://unknown.com/10.0.10/http-heuristics",
				keys: [ "meta.property.citation_doi" ],
			},
			[
				"https://unknown.com/10.0.10/http-heuristics",
				"doi:10.0.10/http-heuristics",
			],
		],
		[ "doi:10.0.2/with-doi-scheme", "doi:10.0.2/with-doi-scheme", "doi: scheme" ],
		[
			"hdl:10.0.3/hdl-scheme", "doi:10.0.3/hdl-scheme",
			"Handle.net registry extension scheme https://www.handle.net/firefox_hdlclient.html"
		],
		[ "info:doi/10.0.8/info-doi", "doi:10.0.8/info-doi" ],
		[ "info:hdl/10.0.9/info-hdl", "doi:10.0.9/info-hdl" ],
		[
			"http://dx.doi.org/10.0.4/dx.doi.org/http-resolver",
			"doi:10.0.4/dx.doi.org/http-resolver",
		],
		[
			"https://dx.doi.org/10.0.5/dx.doi.org/tls-resolver",
			"doi:10.0.5/dx.doi.org/tls-resolver",
		],
		[
			"https://hdl.handle.net/10.0.7(handle.net)resolver",
			"doi:10.0.7(handle.net)resolver",
			"https, handle.net resolver",
		],
		[
			"http://doi.pangaea.de/10.0.6/pangea-http-resolver",
			"doi:10.0.6/pangea-http-resolver",
			"pangaea.de resolver"
		],
		[
			"https://oadoi.org/10.0.11/http-oadoi-unpaywall",
			[ "https://oadoi.org/10.0.11/http-oadoi-unpaywall", "doi:10.0.11/http-oadoi-unpaywall" ],
			"https://unpaywall.org resolver",
		],
		[
			"http://doai.io/10.0.12/http-doai-dissemin",
			[ "http://doai.io/10.0.12/http-doai-dissemin", "doi:10.0.12/http-doai-dissemin" ],
			"doai alternative resolver"
		],
		[
			"https://www.science.org/doi/10.12345/science.abc01234",
			[
				"https://www.science.org/doi/10.12345/science.abc01234",
				"doi:10.12345/science.abc01234"
			],
			"publisher site, with prefix",
		],
		[
			"https://dissem.in/api/10.1016/j.paid.2009.02.013",
			[
				"https://dissem.in/api/10.1016/j.paid.2009.02.013",
				"doi:10.1016/j.paid.2009.02.013"
			],
			"Dissemin https://dissemin.readthedocs.io/en/latest/api.html",
		],
		[ "https://orgmode.org/", null, "reject general URLs" ],
		[ "ftp://dx.doi.org/10.1.1", null, "reject unusual protocol" ],
		[ "https://dx.doi.org/not-a-doi", null, "reject not 10.* code" ],
		[ "http://doai.io/not-a-doi-alt", null, "reject not 10.* code for alternatives" ],
		[ "two words", null, "reject URL consructor error" ],
	];

	lr_test.assignParametrized(
		this, cases_matchDOI,
		function test_matchDOI(url, expect, comment) {
			const actual = lr_meta.matchDOI(typeof url === "string" ? { value: url } : url);
			if (expect && !Array.isArray(expect)) {
				expect = [ expect ];
			}
			if (Array.isArray(expect)) {
				lr_test.assertTrue(Array.isArray(actual), `should be an Array: ${actual}`);
				lr_test.assertEq(actual.length, expect.length);
				for (let i = 0; i < expect.length; ++i) {
					lr_test.assertEq(expect[i], actual[i].value);
				}
			} else {
				lr_test.assertTrue(actual == null, `should be null: ${actual}`);
			}
		});

	Object.assign(this, {
		test_invalidDOI() {
			const variants = [...lr_meta.sanitizeUrl({ value: "bad doi with space", key: "head.name.doi" })];
			lr_test.assertEq(1, variants.length);
			const result = variants[0];
			lr_test.assertEq(result.error, "LrNotURL");
			lr_test.assertEq("bad doi with space", result.value);
		},
	});

	lr_test_meta.cases_sanitizeURL = [
		[
			"httpS://EN.WIKIPEDIA.org/wiki/Wikipedia",
			"https://en.wikipedia.org/wiki/Wikipedia",
			"Protocol and hostname are converted to lower case",
		],
	];

	lr_test.assignParametrized(
		this, lr_test_meta.cases_sanitizeURL,
		function test_sanitizeURL(url, expect, comment) {
			const exp = Array.isArray(expect) ? expect : [ expect ];
			const act = new Set(
				Array.from(lr_meta.sanitizeUrl({value: url}))
				.map(descr => descr.error || descr.value));
			lr_test.assertEq(exp, act, comment);
		});

	Object.assign(this, {
		cases_matchDOI,
	});

	lr_test.suites.push(this);
	return this;
});
