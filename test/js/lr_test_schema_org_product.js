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

var lr_test_schema_org_product = lr_util.namespace(lr_test_schema_org_product,
	function lr_test_schema_org_product()
{
	var lr_test_schema_org_product = this;
	const caseWithAggregateRatingOffer = {
		"@type": "Product",
		"image": "file:///home/nikulin/github/linkremark/test/html/meta/useful-fing.jpg",
		"name": "Vunder SpecialProduct 5X useful thing",
		"aggregateRating": {
			"@type": "AggregateRating",
			"ratingValue": "87",
			"bestRating": "100",
			"ratingCount": "24"
		},
		"offers": {
			"@type": "AggregateOffer",
			"lowPrice": "$1250",
			"highPrice": "$1495",
			"offerCount": "8",
			"offers": [
				{
					"@type": "Offer",
					"url": "https://save-a-lot-things.com/useful-1.html"
				},
				{
					"@type": "Offer",
					"url": "https://thing-gadgets.com/useful-2.html"
				}
			]
		}
	};

	function test_withAggregateRatingOffer() {
		const meta = new LrMeta();
		meta.addDescriptor("schema_org", {
			value: caseWithAggregateRatingOffer, key: "microdata"
		});
		lr_meta.mergeSchemaOrg({}, meta);
		const execInfo = lr_test.withExecutor(
			lr_format_org.format,
			{ _type: "TabFrameChain", elements: [meta]}, null);
		const projection = execInfo.result;
		lr_test.assertEq(
			projection.title,
			"Vunder SpecialProduct 5X useful thing — $1250-$1495(8) — 87/100(0; 24)");
		lr_test.assertEq(projection.body.replace(/^(:DATE_ADDED:) \[.*\]$/m, "$1"),
`* Vunder SpecialProduct 5X useful thing — $1250-$1495(8) — 87/100(0; 24)
:PROPERTIES:
:DATE_ADDED:
:END:

- price :: $1250-$1495(8)
- aggregateRating :: 87/100(0; 24)
- title :: Vunder SpecialProduct 5X useful thing
- image :: [[file:///home/nikulin/github/linkremark/test/html/meta/useful-fing.jpg]]
- offer :: [[https://save-a-lot-things.com/useful-1.html]]
- offer :: [[https://thing-gadgets.com/useful-2.html]]`
		);
		lr_test.assertEq(projection.url, null, "result.url");
		lr_test.assertEq(execInfo.exception, undefined, "execInfo.exception");
		lr_test.assertEq(execInfo.error, null, "execInfo.error");
	}

	Object.assign(lr_test_schema_org_product, {
		caseWithAggregateRatingOffer,
		test_withAggregateRatingOffer,
	});

	const caseWithBrandAndCurrency = {
		"@context": "http://schema.org",
		"@type": "Product",
		"aggregateRating": {
			"@type": "AggregateRating",
			"ratingValue": "5.0",
			"reviewCount": "1"
		},
		"brand": "BrightPack",
		"description": "Wonderful backpack for hiking.\n\nFeatures:\n· Very large.\n· Water-proof.",
		"image": "https://cdn1.kilathlone.buy/s3/multimedia-q/987654321.jpg",
		"name": "Backpack BrightPack v5 dark white 99 l",
		"offers": {
			"@type": "Offer",
			"url": "https://www.kilathlone.buy/product/backpack-hiking-brightpack-v5-123456/",
			"availability": "http://schema.org/OutOfStock",
			"price": "3450",
			"priceCurrency": "CUR"
		},
		"sku": "123456"
	};

	function test_withBrandAndCurrency() {
		// TODO fix locale for currency and number formatting
		const meta = new LrMeta();
		meta.addDescriptor("schema_org", {
			value: {
				"@context": "https://schema.org",
				"@type": "BreadcrumbList",
				"itemListElement": [
					{
						"@type": "ListItem",
						"position": 0,
						"name": "Tourism",
						"item": "https://www.kilathlone,buy/catalog/tourism/hiking/backpack/"
					},
					{
						"@type": "ListItem",
						"position": 1,
						"name": "Hiking",
						"item": "https://www.kilathlone,buy/catalog/tourism/hiking/backpack/"
					},
					{
						"@type": "ListItem",
						"position": 2,
						"name": "Backpacks",
						"item": "https://www.kilathlone,buy/catalog/tourism/hiking/backpack/"
					}
				]
			},
			key: "document.script.ld_json",
		});
		meta.addDescriptor("schema_org", {
			value: caseWithBrandAndCurrency, key: "microdata"
		});
		const url = "https://url.kilathlone.buy/product/backpack-hiking-brightpack-v5-123456/";
		meta.addDescriptor("url", {
			value: url,
			key: "tab.url"
		});
		lr_meta.mergeSchemaOrg({}, meta);
		const execInfo = lr_test.withExecutor(
			lr_format_org.format,
			{ _type: "TabFrameChain", elements: [meta]}, null);
		const projection = execInfo.result;
		lr_test.assertEq(
			projection.title,
			"Backpack BrightPack v5 dark white 99 l — CUR 3,450.00 — OutOfStock — 5.0(1)");
		lr_test.assertEq(projection.body.replace(/^(:DATE_ADDED:) \[.*\]$/m, "$1"),
`* Backpack BrightPack v5 dark white 99 l — CUR 3,450.00 — OutOfStock — 5.0(1)
:PROPERTIES:
:DATE_ADDED:
:END:

- URL :: [[https://url.kilathlone.buy/product/backpack-hiking-brightpack-v5-123456/]]
- URL :: [[https://www.kilathlone.buy/product/backpack-hiking-brightpack-v5-123456/]]
- brand :: BrightPack
- price :: CUR 3,450.00
- availability :: OutOfStock
- aggregateRating :: 5.0(1)
- title :: Backpack BrightPack v5 dark white 99 l
- sku :: 123456
- description :: Wonderful backpack for hiking.

  Features:
  · Very large.
  · Water-proof.
- image :: [[https://cdn1.kilathlone.buy/s3/multimedia-q/987654321.jpg]]`
		);
		lr_test.assertEq(projection.url, url, "result.url");
		lr_test.assertEq(execInfo.exception, undefined, "execInfo.exception");
		lr_test.assertEq(execInfo.error, null, "execInfo.error");
	}
	Object.assign(lr_test_schema_org_product, {
		caseWithBrandAndCurrency,
		test_withBrandAndCurrency,
	});

	const caseWithAggregateRating = {
		"@type": "Product",
		"name": "Vunder SpecialProduct 5X title test",
		"aggregateRating": {
			"@type": "AggregateRating",
			"ratingValue": "87",
			"bestRating": "100",
			"ratingCount": "24"
		},
	};

	function test_withAggregateRatingShortDescription() {
		const meta = new LrMeta();
		meta.addDescriptor("schema_org", {
			value: caseWithAggregateRating, key: "microdata"
		});
		meta.addDescriptor("description", {
			value: "Description is not title",
			key: "meta.name.description",
		});
		lr_meta.mergeSchemaOrg({}, meta);
		const execInfo = lr_test.withExecutor(
			lr_format_org.format,
			{ _type: "TabFrameChain", elements: [meta]}, null);
		const projection = execInfo.result;
		lr_test.assertEq(
			projection.title,
			"Vunder SpecialProduct 5X title test — 87/100(0; 24)");
		lr_test.assertEq(projection.body.replace(/^(:DATE_ADDED:) \[.*\]$/m, "$1"),
`* Vunder SpecialProduct 5X title test — 87/100(0; 24)
:PROPERTIES:
:DATE_ADDED:
:END:

- aggregateRating :: 87/100(0; 24)
- title :: Vunder SpecialProduct 5X title test
- description :: Description is not title`
		);
		lr_test.assertEq(projection.url, null, "result.url");
		lr_test.assertEq(execInfo.exception, undefined, "execInfo.exception");
		lr_test.assertEq(execInfo.error, null, "execInfo.error");
	}

	Object.assign(lr_test_schema_org_product, {
		caseWithAggregateRating,
		test_withAggregateRatingShortDescription,
	});

	const caseWithZeroPriceAndNoBrand = {
		"@context": "http://schema.org",
		"@type": "Product",
		"description": "Some obsolete product.",
		"image": "https://sold.out/pic/2222322.jpg",
		"name": "Just Hole",
		"offers": {
			"@type": "Offer",
			"url": "https://trash.buy/product/just-hole-234/",
			"availability": "http://schema.org/OutOfStock",
			"price": "0",
			"priceCurrency": "CUR"
		},
	};
	function test_withZeroPriceAndNoBrand() {
		const meta = new LrMeta();
		meta.addDescriptor("schema_org", {
			value: caseWithZeroPriceAndNoBrand, key: "microdata"
		});
		lr_meta.mergeSchemaOrg({}, meta);
		const execInfo = lr_test.withExecutor(
			lr_format_org.format,
			{ _type: "TabFrameChain", elements: [meta]}, null);
		const projection = execInfo.result;
		lr_test.assertEq(
			projection.title,
			"Just Hole — OutOfStock");
		lr_test.assertEq(projection.body.replace(/^(:DATE_ADDED:) \[.*\]$/m, "$1"),
`* Just Hole — OutOfStock
:PROPERTIES:
:DATE_ADDED:
:END:

- URL :: [[https://trash.buy/product/just-hole-234/]]
- availability :: OutOfStock
- title :: Just Hole
- description :: Some obsolete product.
- image :: [[https://sold.out/pic/2222322.jpg]]`
		);
		lr_test.assertEq(projection.url, "https://trash.buy/product/just-hole-234/", "result.url");
		lr_test.assertEq(execInfo.exception, undefined, "execInfo.exception");
		lr_test.assertEq(execInfo.error, null, "execInfo.error");
	}

	Object.assign(lr_test_schema_org_product, {
		caseWithZeroPriceAndNoBrand,
		test_withZeroPriceAndNoBrand,
	});

	lr_test.suites.push(lr_test_schema_org_product);
	return lr_test_schema_org_product;
});
