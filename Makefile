
MAKE_MANIFEST = tools/make_manifest.py

# For development with almost no build step.
firefox: manifest-firefox.json
	ln -sf manifest-firefox.json manifest.json

manifest-firefox.json: manifest-common.json manifest-part-firefox.json
	$(MAKE_MANIFEST) --output $@ $^

# For development with almost no build step.
# Not a real dependency-aware target
# extension id: mgmcoaemjnaehlliifkgljdnbpedihoe
chrome: manifest-chrome.json
	ln -sf manifest-chrome.json manifest.json

manifest-chrome.json: manifest-common.json manifest-part-chrome.json
	$(MAKE_MANIFEST) --output $@ $^

test:
	test/test_json_files.py

clean:
	$(RM) manifest.json

firefox-dist: firefox
	out=`cat manifest-common.json | \
		python3 -c "import json, sys; print(json.load(sys.stdin)['version'])"` ; \
	file="linkremark-$${out}.unsigned.xpi" ; \
	$(RM) "$$file" ; \
	zip "$$file" manifest.json \
		"background/init.js" \
		"common/bapi.js" \
		"background/lr_util.js" \
		"background/lr_format_org.js" \
		"background/meta.js" \
		"background/native.js" \
		"common/org_protocol.js" \
		"background/result_cache.js" \
		"background/rpc_server.js" \
		"background/lr_settings.js" \
		"background/async_script.js" \
		"background/lr_export.js" \
		"background/lr_clipboard.js" \
		"background/lr_native_messaging.js" \
		"background/lr_tabframe.js" \
		"background/lr_action.js" \
		"background/main.js" \
		"pages/settings.html" \
		"pages/settings.js" \
		"pages/lr.css" \
		"pages/preview.js" \
		"pages/preview.html" \
		"content_scripts/link.js" \
		"content_scripts/image.js" \
		"content_scripts/capture.js" \
		"content_scripts/clipboard.js" \
		"content_scripts/meta.js" \
		"content_scripts/referrer.js" \
		"icons/lr-light-16.png" \
		"icons/lr-32.png" \
		"icons/lr-light-32.png" \
		"icons/lr-96.png" \
		"icons/lr-128.png" \
		"icons/lr-16.png" \
		"icons/lr-48.png" \
		"_locales/en/messages.json"

.PHONY: clean crome firefox test firefox-dist"
