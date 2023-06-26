
MAKE_MANIFEST = tools/make_manifest.py
MAKE_SW = tools/make_sw.py
MANIFEST_FIREFOX_src = manifest-common.yaml manifest-part-firefox.yaml
MANIFEST_TEST_src = manifest-part-test.yaml
MANIFEST_FIREFOX_TEST_src = $(MANIFEST_FIREFOX_src) $(MANIFEST_TEST_src)

MANIFEST_CHROME_DEV_src = manifest-part-chrome-dev.yaml
MANIFEST_CHROME_src = manifest-common.yaml manifest-part-chrome.yaml
MANIFEST_CHROME_TEST_src = $(MANIFEST_CHROME_src)
MANIFEST_CHROME_TEST_src += $(MANIFEST_CHROME_DEV_src)

SW_JS = lr_sw.js
SW_DIST_JS = lr_sw_dist.js
SW_SRC += \
	background/lr_force_sw_activate.js \
	mwel/common/mwel_console.js \
	background/lr_con.js \
	common/bapi.js \
	common/lr_common.js \
	background/lr_util.js \
	background/lr_multimap.js \
	background/lr_iter.js \
	background/lr_actionlock.js \
	background/lr_executor.js \
	background/lr_formatter.js \
	background/lr_format_org.js \
	background/lr_org_buffer.js \
	background/lr_org_tree.js \
	background/lr_schema_org.js \
	background/lr_meta.js \
	common/lr_org_protocol.js \
	background/lr_rpc_store.js \
	background/lr_addon_rpc.js \
	background/lr_settings.js \
	background/lr_export.js \
	background/lr_abortable_ctx.js \
	background/lr_clipboard.js \
	background/lr_native_connection.js \
	background/lr_native_export.js \
	background/lr_scripting.js \
	background/lr_tabframe.js \
	background/lr_notify.js \
	background/lr_action.js \
	background/lr_schema_org_product.js

SW_TEST_JS = lr_sw_test.js
SW_TEST_SRC += \
	test/js/lr_test.js \
	test/js/lr_test_org.js \
	test/js/lr_test_org_tree.js \
	test/js/lr_test_json_ld.js \
	test/js/lr_test_format_org.js \
	test/js/lr_test_meta.js \
	test/js/lr_test_microdata.js \
	test/js/lr_test_schema_org_product.js \
	test/js/lr_test_abortable_ctx.js

SW_INIT = background/init_linkremark.js
SW_MAIN = background/main_linkremark.js

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

ORG_RUBY = org-ruby
ORG_RUBY_FLAGS = -t html
ORG_RUBY_HEADER = printf '<!DOCTYPE html>\n<style>body { width: 66ex; margin: auto; }</style>'

# E.g. to redefine directory to load Org
#     EMACS_FLAGS += --directory ~/src/org-mode/lisp
-include local.mk

# For development with almost no build step.
firefox: manifest-firefox.json $(HELP_PAGE)
	ln -sf manifest-firefox.json manifest.json

firefox-test: manifest-firefox-test.json $(HELP_PAGE)
	ln -sf manifest-firefox-test.json manifest.json

manifest-firefox.json: $(MANIFEST_FIREFOX_src)
	$(MAKE_MANIFEST) --output $@ $(MANIFEST_FIREFOX_src)

manifest-firefox-test.json: $(MANIFEST_FIREFOX_TEST_src)
	$(MAKE_MANIFEST) --output $@ $(MANIFEST_FIREFOX_TEST_src)

manifest-firefox.json manifest-firefox-test.json: $(MAKE_MANIFEST) Makefile

# For development with almost no build step.
# Not a real dependency-aware target
# extension id: mgmcoaemjnaehlliifkgljdnbpedihoe
chrome: $(SW_DIST_JS) manifest-chrome.json $(HELP_PAGE)
	ln -sf manifest-chrome.json manifest.json
	ln -sf $(SW_DIST_JS) $(SW_JS)

chrome-test: $(SW_TEST_JS) manifest-chrome-test.json $(HELP_PAGE)
	ln -sf manifest-chrome-test.json manifest.json
	ln -sf $(SW_TEST_JS) $(SW_JS)

manifest-chrome.json: $(MANIFEST_CHROME_src) $(MANIFEST_CHROME_DEV_src)
	$(MAKE_MANIFEST) --output $@ $(MANIFEST_CHROME_src) $(MANIFEST_CHROME_DEV_src)

manifest-chrome-dist.json: $(MANIFEST_CHROME_src)
	$(MAKE_MANIFEST) --output $@ $(MANIFEST_CHROME_src)

manifest-chrome-test.json: $(MANIFEST_CHROME_TEST_src)
	$(MAKE_MANIFEST) --output $@ $(MANIFEST_CHROME_TEST_src)

manifest-chrome.json manifest-chrome-test.json manifest-chrome-dist.json: $(MAKE_MANIFEST) Makefile

$(HELP_PAGE): README.org tools/help.el
	$(EMACS) $(EMACS_FLAGS) --load tools/help.el

test:
	test/test_json_files.py

clean:
	$(RM) manifest.json
	$(RM) README.html

firefox-dist: firefox
	set -e ; \
	out="`cat manifest-firefox.json | \
		python3 -c "import json, sys; print(json.load(sys.stdin)['version'])"`" ; \
	background="`python3 -c 'import sys,json; print(" ".join(json.load(sys.stdin)["background"]["scripts"]))' < manifest.json`" ; \
	file="linkremark-$${out}-unsigned.xpi" ; \
	$(RM) "$$file" ; \
	zip --must-match "$$file" manifest.json $$background \
		$(PAGES_SRC) $(CONTENT_SRC) $(ICONS_SRC) \
		"_locales/en/messages.json" ; \
	echo "Created $$file"

chrome-dist: chrome manifest-chrome-dist.json $(HELP_PAGE)
	ln -sf manifest-chrome-dist.json manifest.json
	set -e ; \
	version="`python3 -c 'import json, sys; print(json.load(sys.stdin)["version"])' <manifest-chrome.json`" ; \
	file="linkremark-$${version}.zip" ; \
	$(RM) "$$file" ; \
	zip --must-match "$$file" manifest.json \
		$(SW_JS) $(SW_INIT) $(SW_SRC) $(SW_MAIN) \
		$(PAGES_SRC) $(CONTENT_SRC) $(ICONS_SRC) \
		"_locales/en/messages.json" ; \
	echo "Created $$file"

$(SW_DIST_JS): $(MAKE_SW) Makefile
	$(MAKE_SW) --output $@ \
		--init $(SW_INIT) --main $(SW_MAIN) $(SW_SRC)

$(SW_TEST_JS): $(MAKE_SW) Makefile
	$(MAKE_SW) --output $@ \
		--init $(SW_INIT) --main $(SW_MAIN) $(SW_SRC) $(SW_TEST_SRC)

# Writing to a build directory causes an issue with the image
# included from `doc/`. `<base href="../">` makes `<a href"#...">`
# links invalid. An alternative is a symlink to `doc` from
# the build directory.
test-readme:
	$(ORG_RUBY_HEADER) >README.html
	$(ORG_RUBY) $(ORG_RUBY_FLAGS) README.org >>README.html

.PHONY: clean chrome firefox test firefox-dist firefox-test chrome-test chrome-dist test-readme
