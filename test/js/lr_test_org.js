
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

var lr_test_org = lr_util.namespace(lr_test_org, function lr_test_org() {
	var lr_test_org = this;

	/*
	 * [ orginal href, escaped for link part, escaped for description part, comment ]
	 */
	this.casesSafeUrl = [
		["https://orgmode.org/", "https://orgmode.org/", "https://orgmode.org/", "simple URL"],
		[
			"https://orgmode.org/org.html",
			"https://orgmode.org/org.html",
			"https://orgmode.org/org.html",
			"simple URL"
		],
		["http://localhost:8080/", "http://localhost:8080/", "http://localhost:8080/", "with port"],
		["http://[::1]/", "http://\\[::1\\]/", "http://[::1]/", "IPv6 address"],
		["http://site-name.com/", "http://site-name.com/", "http://site-name.com/", "dash in hostname"],
		[
			"http://ho.st/dash-path#dash-anchor",
			"http://ho.st/dash-path#dash-anchor",
			"http://ho.st/dash-path#dash-anchor",
			"Dash in path or anchor",
		],
		[
			"http://te.st/dir?b-=&a=-",
			"http://te.st/dir?b%2D=&a=%2D",
			"http://te.st/dir?b-=&a=-",
			"Dash-equal problem in org 9.4",
		],
        [
			"https://ho.st/bug#hash{~code~}",
			"https://ho.st/bug#hash%7B~code~%7D",
			"https://ho.st/bug#hash{~code~}",
			"Rich text: code in curly brackets",
		],
        [
			"https://ho.st/bug#hash(=verbatim=)",
			"https://ho.st/bug#hash%28=verbatim=%29",
			"https://ho.st/bug#hash(=verbatim=)",
			"Rich text: verbatim in parenthesis",
		],
        [
			"https://ho.st/bug#hash[*bold*]",
			"https://ho.st/bug#hash%5B*bold*%5D",
			"https://ho.st/bug#hash[*bold*]\u200B",
			"Rich text: bold in brackets",
		],
        [
			"https://ho.st/bug#hash!+strike+!",
			"https://ho.st/bug#hash%21+strike+%21",
			"https://ho.st/bug#hash!+strike+!",
			"Rich text: strike-through and exclamation",
		],
        [
			"https://ho.st/bug#hash\\/italic/\\",
			"https://ho.st/bug#hash%5C/italic/%5C",
			"https://ho.st/bug#hash\\/italic/\\", // No need to escape trailing backslash in description
			"Rich text: italic and backslashes",
		],
        [
			"https://ho.st/bug#hash{_underscore_}",
			"https://ho.st/bug#hash%7B_underscore_%7D",
			"https://ho.st/bug#hash{_underscore_}",
			"Rich text: underscore",
		],
		[ "http://te.st/a?p=]]", "http://te.st/a?p=%5D%5D", "http://te.st/a?p=]\u200B]", "closing brackets" ],
		[
			"file:///%D0%9A%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3/%D0%A4%D0%B0%D0%B9%D0%BB.txt",
			"file:///%D0%9A%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3/%D0%A4%D0%B0%D0%B9%D0%BB.txt",
			"file:///Каталог/Файл.txt",
			"Unicode pathname",
		],
		[
			"http://%D0%BB%5B%D0%BE%5D%D0%B3@te.st/dir",
			"http://%D0%BB%5B%D0%BE%5D%D0%B3@te.st/dir",
			"http://л[о]г@te.st/dir",
			"brackets in username"
		],
		[
			"http://:(~pass~!)@te.st/dir",
			"http://:%28~pass~%21%29@te.st/dir",
			"http://:(~pass~!)@te.st/dir",
			"rich text in password"
		],
	];

	this.test_safeUrl = lr_test.parametrize(
		this.casesSafeUrl,
		function test_safeUrl(url, safe, _readable) {
			lr_test.assertEq(lr_org_buffer.safeUrl(url), safe);
		});

	this.test_readableUrl = lr_test.parametrize(
		this.casesSafeUrl,
		function test_readableUrl(url, _safe, readable) {
			lr_test.assertEq(lr_org_buffer.readableUrl(url), readable);
		});

	this.casesLengthLimit = [
		[
			"https://some.long.host.name.with-a-lot-of.components.com/",
			15,
			"https://s….com/",
		],
		[
			"ftp://te.st/long/path/to/the/file.txt",
			20,
			"ftp://te.st/…ile.txt",
		],
		[
			"ftp://te.st/long/path/to/the/file.txt",
			19,
			"ftp://te.st/…le.txt",
		],
		[
			"<ftp://te.st/long/path/to/the/file.txt>",
			19,
			"<ftp://te.st…e.txt>",
		],
	];
	this.test_readableUrlLength = lr_test.parametrize(
		this.casesLengthLimit,
		function test_readableUrlLength(url, lengthLimit, expectation) {
			const result = lr_org_buffer.readableUrl(url, lengthLimit);
			lr_test.assertEq(expectation, result);
			lr_test.assertEq(result.length, lengthLimit);
		});

	lr_test.suites.push(this);
	return this;
});
