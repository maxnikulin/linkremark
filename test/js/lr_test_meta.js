
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

var lr_test_meta = lr_util.namespace("lr_test_meta", lr_test_meta, function() {
	this.casesValid = [
		[ "10.0.1/just-doi", "doi:10.0.1/just-doi" ],
		[ "doi:10.0.2/with-doi-schema", "doi:10.0.2/with-doi-schema" ],
		[
			"hdl:10.0.3/hdl-schema", "doi:10.0.3/hdl-schema",
			"Handle.net registry extension schema https://www.handle.net/firefox_hdlclient.html"
		],
		[
			"http://dx.doi.org/10.0.4/dx.doi.org/http-resolver",
			"doi:10.0.4/dx.doi.org/http-resolver",
		],
		[
			"https://dx.doi.org/10.0.5/dx.doi.org/tls-resolver",
			"doi:10.0.5/dx.doi.org/tls-resolver",
		],
		[
			"http://doi.pangaea.de/10.0.6/pangea-http-resolver",
			"doi:10.0.6/pangea-http-resolver",
		],
		[
			"https://hdl.handle.net/10.0.7(handle.net)resolver",
			"doi:10.0.7(handle.net)resolver",
		],
		[ "info:doi/10.0.8/info-doi", "doi:10.0.8/info-doi" ],
		[ "info:hdl/10.0.9/info-hdl", "doi:10.0.9/info-hdl" ],
		[ "https://unknown.com/10.0.10/http-heuristics", "doi:10.0.10/http-heuristics" ],
		[
			"https://oadoi.org/10.0.11/http-oadoi-unpaywall", "doi:10.0.11/http-oadoi-unpaywall",
			"https://unpaywall.org resolver",
		],
		[ "http://doai.io/10.0.12/http-doai-dissemin", "doi:10.0.12/http-doai-dissemin" ],
		// "TODO: https://dissem.in/api/ https://dissemin.readthedocs.io/en/latest/api.html"
	];

	this.test_validDOI = lr_test.parametrize(
		this.casesValid,
		function test_validDOI(input, doi, comment) {
			const result = lr_meta.sanitizeDOI(input);
			lr_test.assertEq(doi, result.value);
			lr_test.assertTrue(!result.error);
		});

	/* Have not managed to invent argument that causes TypeError exception
	 * while constructing URL object with "doi:" prefix */
	/*
	this.test_invalidDOI = function() {
		const result = lr_meta.sanitizeDOI("bad doi with space");
		lr_test.assertTrue(result.error);
		lr_test.assertEq("bad doi with space", result.value);
	};
	*/

	lr_test.suites.push(this);
	return this;
});
