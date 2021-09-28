/*
   Copyright (C) 2020-2021 Max Nikulin

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
	/* It seems it is safer to avoid double slash "org-protocol://"
	 * and it is better to choose either single or triple slash.
	 * At least one slash is required by `org-protocol.el`.
	 * With double slash after the scheme, subprotocols
	 * "capture" or "store-link" considered as netloc (host name).
	 * It was a problem with old org-protocol
	 * syntax with colon after subprotocol
	 *
	 *     org-protocol://store-link:/URL/TITLE
	 *
	 * Likely kde-open5 and "gio open" drops second ":"
	 * since it should be followed by port number. Due to absence
	 * of a valid port, handler was invoked without colon
	 * leading to an error in emacs.
	 * Modern Org emits a warning demanding to update handler,
	 * and with new syntax
	 *
	 *     org-protocol:/store-link?url=URL&title=TITLE
	 *
	 * it does not matter if subprotocol is considered as host name
	 * or as path with the following exception.
	 * In the case of double slash, a slash before "?" might be required
	 * to separate host name (subprotocol) and query by explicit path "/".
	 * See commit 928e67df7e in org-mode repository.
	 *
	 * Do not quote %u in the ".desktop" file:
	 * https://specifications.freedesktop.org/desktop-entry-spec/desktop-entry-spec-latest.html#exec-variables
	 *
	 * > Field codes must not be used inside a quoted argument,
	 * > the result of field code expansion inside a quoted argument is undefined.
	 *
	 * Let's try single slash. */
	this.URL_CAPTURE = 'org-protocol:/capture';

	/* Make URL like
	 * "org-protocol:/capture?template=x&title=Hello&body=World&url=http:%2F%2Fexample.com"
	 * from object { template: 'x', title: 'Hello', body: 'World', url: 'http://example.com' }
	 * `base` is capture or store-link sub-protocol URI base.
	 *
	 * `template` field is optional. Emacs shows prompt if it is omitted.
	 */
	this.makeUrl = function(params, base=lrOrgProtocol.URL_CAPTURE) {
		// Prevent conversion of `undefined` to `"undefined"` string.
		// Empty template can cause a problem in Emacs.
		for (const [ key, value ] of Object.entries(params)) {
			if (value == null || value === "") {
				delete params[key];
			}
		}
		const url = new URL(base);
		const query = new URLSearchParams(params);
		// url.searchParams is a read-only attribute
		// and it does not have a method to set all parameters at once.
		// Org-protocol at first used path components as positional
		// parameters. Later a kind of query part has been implemented
		// but decode function does not support encoding space as '+'
		// wide spread for encoding of URLs. Since Org-9.5 (commit 09dc3fa304)
		// '+' should be decoded. Let's keep compatibility with long time
		// support distributions.
		url.search = query.toString().replace(/\+/g, '%20');
		return url.toString();
	};

	return this;
}.call(lrOrgProtocol || {});
