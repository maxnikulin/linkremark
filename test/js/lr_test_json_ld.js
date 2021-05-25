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

var lr_test_json_ld = lr_util.namespace(lr_test_json_ld, function lr_test_json_ld() {
	var lr_test_json_ld = this;
	function metaValues(meta, field) {
		const valueObjects = meta.get(field);
		return valueObjects && valueObjects.map(o => o.value);
	}

	/*
	 * - `mainEntityOfPage` is just a reference to page url
	 * - `image` is an array
	 * - site name should be extracted from `publisher`
	 */
	var caseArticle = {
		"@context": "http://schema.org",
		"@type": "Article",
		"mainEntityOfPage": {
			"@type": "WebPage",
			"@id": "https://ho.st/post/312/"
		},
		"headline": "LD Article headline",
		"datePublished": "2020-01-07T15:03:24+03:00",
		"dateModified": "2020-01-08T07:06:00+03:00",
		"author": {
			"@type": "Person",
			"name": "Tom Soyer"
		},
		"publisher": {
			"@type": "Organization",
			"name": "Si-Te",
			"logo": {
				"@type": "ImageObject",
				"url": "https://c.dn/images/si-te.png"
			}
		},
		"description": "This is a description in ld+json for Article @type.",
		"url": "https://hos.st/post/312/#post-content-body",
		"about": [
			"a_keyword-one",
			"a_second",
			"a_topic-3",
		],
		"image": [
			"https://stora.ge/web/q/qwerty.jpeg",
			"https://stora.ge/web/a/asdfgh.png"
		]
	};

	this.test_article = function() {
		const meta = new LrMeta();
		lr_json_ld.mergeJsonLd(caseArticle, meta);
		lr_test.assertEq(new Set(["Tom Soyer"]), metaValues(meta, "author"));
		lr_test.assertEq(
			new Set(["https://stora.ge/web/q/qwerty.jpeg", "https://stora.ge/web/a/asdfgh.png"]),
			metaValues(meta, "image"));
		lr_test.assertEq(
			new Set([
				"https://hos.st/post/312/#post-content-body",
				"https://ho.st/post/312/",
			]), metaValues(meta, "url"));
		lr_test.assertEq(new Set(["Si-Te"]), metaValues(meta, "site_name"));
		lr_test.assertEq(new Set(["LD Article headline"]), metaValues(meta, "title"));
		lr_test.assertEq(
			new Set(["This is a description in ld+json for Article @type."]),
			metaValues(meta, "description"));
		// console.log(JSON.stringify(meta.object, null, "  "));
	};

	var caseGraph = {
	  "@context": "https://schema.org",
	  "@graph": [
		{
		  "@type": "WebSite",
		  "@id": "https://blog.te.st/topic/#website",
		  "url": "https://blog.te.st/topic/",
		  "name": "Te.st blg",
		  "description": "",
		  "potentialAction": [
			{
			  "@type": "SearchAction",
			  "target": "https://blog.te.st/topic/?s={search_term_string}",
			  "query-input": "required name=search_term_string"
			}
		  ],
		  "inLanguage": "en-US"
		},
		{
		  "@type": "ImageObject",
		  "@id": "https://blog.te.st/topic/6-5-4/some-post/#primaryimage",
		  "inLanguage": "en-US",
		  "url": "https://blog.te.st/topic/fls/bst-pc.png",
		  "width": 1525,
		  "height": 165,
		  "caption": "Best pic for some post"
		},
		{
		  "@type": "WebPage",
		  "@id": "https://blog.te.st/topic/6-5-4/some-post/#webpage",
		  "url": "https://blog.te.st/topic/6-5-4/some-post/",
		  "name": "Ttle of the blg post - Te.st blg",
		  "isPartOf": {
			"@id": "https://blog.te.st/topic/#website"
		  },
		  "primaryImageOfPage": {
			"@id": "https://blog.te.st/topic/6-5-4/some-post/#primaryimage"
		  },
		  "datePublished": "2018-01-31T15:11:14+00:00",
		  "dateModified": "2018-01-31T15:11:14+00:00",
		  "author": {
			"@id": "https://blog.te.st/topic/#/schema/person/987654"
		  },
		  "description": "Lorem ipsum some garbage for description test. Another sentence to make it longer.",
		  "inLanguage": "en-US",
		  "potentialAction": [
			{
			  "@type": "ReadAction",
			  "target": [
				"https://blog.te.st/topic/6-5-4/some-post/"
			  ]
			}
		  ]
		},
		{
		  "@type": "Person",
		  "@id": "https://blog.te.st/topic/#/schema/person/987654",
		  "name": "Pson Nme",
		  "image": {
			"@type": "ImageObject",
			"@id": "https://blog.te.st/topic/#personlogo",
			"inLanguage": "en-US",
			"url": "https://afat.ar/123456",
			"caption": "In Caption"
		  },
		  "description": "Test Engnr",
		  "sameAs": [
			"https://auth.or",
			"https://twitter.com/a_u_thor"
		  ]
		}
	  ]
	};

	this.test_graph = function() {
		const meta = new LrMeta();
		lr_json_ld.mergeJsonLd(caseGraph, meta);
		// console.log(JSON.stringify(meta.object, null, "  "));
		lr_test.assertEq(new Set(["Pson Nme"]), metaValues(meta, "author"));
		lr_test.assertEq(
			new Set(["https://blog.te.st/topic/fls/bst-pc.png"]),
			metaValues(meta, "image"));
		lr_test.assertEq(
			new Set([
				"https://blog.te.st/topic/6-5-4/some-post/#webpage",
				"https://blog.te.st/topic/6-5-4/some-post/",
			]), metaValues(meta, "url"));
		lr_test.assertEq(new Set(["Te.st blg"]), metaValues(meta, "site_name"));
		lr_test.assertEq(new Set(["Ttle of the blg post - Te.st blg"]), metaValues(meta, "title"));
		lr_test.assertEq(
			new Set(["Lorem ipsum some garbage for description test. Another sentence to make it longer."]),
			metaValues(meta, "description"));
	};


	Object.assign(this, {
		caseArticle, caseGraph,
	});
	lr_test.suites.push(this);
	return this;
});
