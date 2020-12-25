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

var lrOrgProtocol = function() {
	this.URL_CAPTURE = 'org-protocol://capture';

	/* Make URL like
	 * "org-protocol://capture?template=x&title=Hello&body=World&url=http:%2F%2Fexample.com"
	 * from object { template: 'x', title: 'Hello', body: 'World', url: 'http://example.com' }
	 * `base` is capture or store-link sub-protocol URI base.
	 */
	this.makeUrl = function(params, base=lrOrgProtocol.URL_CAPTURE) {
		/*
		if (!params.template) {
			throw new Error("lrOrgProtocol.makeUrl: template is not specified");
		}
		*/
		const url = new URL(base);
		const query = new URLSearchParams(params);
		// url.searchParams is a read-only attribute
		// and it does not have a method to set all parameters at once.
		// Org-protocol at first used path components as positional
		// parameters. Later a kind of query part has been implemented
		// but decode function does not support encoding space as '+'
		// wide spread for encoding of URLs.
		url.search = query.toString().replace(/\+/g, '%20');
		return url.toString();
	};

	return this;
}.call(lrOrgProtocol || {});
