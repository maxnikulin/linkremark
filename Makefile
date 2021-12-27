
MAKE_MANIFEST = tools/make_manifest.py
MANIFEST_FIREFOX_src = manifest-common.json manifest-part-firefox.json
MANIFEST_TEST_src = manifest-part-test.yaml
MANIFEST_FIREFOX_TEST_src = $(MANIFEST_FIREFOX_src) $(MANIFEST_TEST_src)

MANIFEST_CHROME_DEV_src = manifest-part-chrome-dev.yaml
MANIFEST_CHROME_src = manifest-common.json manifest-part-chrome.json
MANIFEST_CHROME_TEST_src = $(MANIFEST_CHROME_src) $(MANIFEST_TEST_src)
MANIFEST_CHROME_TEST_src += $(MANIFEST_CHROME_DEV_src)

HELP_PAGE = pages/lrp_help.html

PAGES_SRC = pages/lr_dom.js pages/lrp_irreducible.js pages/lrp_permissions.js 
PAGES_SRC += pages/lrp_help.js pages/lrp_navigation.js
PAGES_SRC += pages/lrp_settings.html pages/lrp_settings.js 
PAGES_SRC += pages/lrp_preview_model.js pages/lrp_mentions.js pages/lrp_preview.js 
PAGES_SRC += pages/lr.css pages/lrp_preview.html
PAGES_SRC += pages/lr_browseraction.html pages/lr_browseraction.css pages/lr_browseraction.js
PAGES_SRC += $(HELP_PAGE)

CONTENT_SRC += content_scripts/lrc_selection.js content_scripts/lrc_clipboard.js
CONTENT_SRC += content_scripts/lrc_image.js content_scripts/lrc_link.js
CONTENT_SRC += content_scripts/lrc_meta.js content_scripts/lrc_microdata.js 
CONTENT_SRC += content_scripts/lrc_relations.js

ICONS_SRC += icons/lr-16.png icons/lr-32.png
ICONS_SRC += icons/lr-24.png icons/lr-48.png
ICONS_SRC += icons/lr-64.png icons/lr-128.png

EMACS = LC_ALL=en_US.UTF-8 TZ=Z LANGUAGE=en emacs
EMACS_FLAGS = --batch --no-init-file

# E.g. to redefine directory to load Org
#     EMACS_FLAGS += --directory ~/src/org-mode/lisp
include local.mk

# For development with almost no build step.
firefox: manifest-firefox.json $(HELP_PAGE)
	ln -sf manifest-firefox.json manifest.json

firefox-test: manifest-firefox-test.json $(HELP_PAGE)
	ln -sf manifest-firefox-test.json manifest.json

manifest-firefox.json: $(MANIFEST_FIREFOX_src)
	$(MAKE_MANIFEST) --output $@ $(MANIFEST_FIREFOX_src)

manifest-firefox-test.json: $(MANIFEST_FIREFOX_TEST_src)
	$(MAKE_MANIFEST) --output $@ $(MANIFEST_FIREFOX_TEST_src)

manifest-firefox.json manifest-firefox-test.json: $(MAKE_MANIFEST)

# For development with almost no build step.
# Not a real dependency-aware target
# extension id: mgmcoaemjnaehlliifkgljdnbpedihoe
chrome: manifest-chrome.json $(HELP_PAGE)
	ln -sf manifest-chrome.json manifest.json

chrome-test: manifest-chrome-test.json $(HELP_PAGE)
	ln -sf manifest-chrome-test.json manifest.json

manifest-chrome.json: $(MANIFEST_CHROME_src) $(MANIFEST_CHROME_DEV_src)
	$(MAKE_MANIFEST) --output $@ $(MANIFEST_CHROME_src) $(MANIFEST_CHROME_DEV_src)

manifest-chrome-dist.json: $(MANIFEST_CHROME_src)
	$(MAKE_MANIFEST) --output $@ $(MANIFEST_CHROME_src)

manifest-chrome-test.json: $(MANIFEST_CHROME_TEST_src)
	$(MAKE_MANIFEST) --output $@ $(MANIFEST_CHROME_TEST_src)

manifest-chrome.json manifest-chrome-test.json manifest-chrome-dist.json: $(MAKE_MANIFEST)

$(HELP_PAGE): README.org tools/help.el
	$(EMACS) $(EMACS_FLAGS) --load tools/help.el

test:
	test/test_json_files.py

clean:
	$(RM) manifest.json

firefox-dist: firefox
	set -e ; \
	out="`cat manifest-common.json | \
		python3 -c "import json, sys; print(json.load(sys.stdin)['version'])"`" ; \
	background="`python3 -c 'import sys,json; print(" ".join(json.load(sys.stdin)["background"]["scripts"]))' < manifest.json`" ; \
	file="linkremark-$${out}-unsigned.xpi" ; \
	$(RM) "$$file" ; \
	zip --must-match "$$file" manifest.json $$background \
		$(PAGES_SRC) $(CONTENT_SRC) $(ICONS_SRC) \
		"_locales/en/messages.json" ; \
	echo "Created $$file"

chrome-dist: manifest-chrome-dist.json $(HELP_PAGE)
	ln -sf manifest-chrome-dist.json manifest.json
	set -e ; \
	version="`python3 -c 'import json, sys; print(json.load(sys.stdin)["version"])' <manifest-chrome.json`" ; \
	background="`python3 -c 'import sys,json; print(" ".join(json.load(sys.stdin)["background"]["scripts"]))' < manifest.json`" ; \
	file="linkremark-$${version}.zip" ; \
	$(RM) "$$file" ; \
	zip --must-match "$$file" manifest.json $$background \
		$(PAGES_SRC) $(CONTENT_SRC) $(ICONS_SRC) \
		"_locales/en/messages.json" ; \
	echo "Created $$file"

.PHONY: clean crome firefox test firefox-dist firefox-test chrome-test chrome-dist
