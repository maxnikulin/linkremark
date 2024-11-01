;; Convert a part of README.org to pages/lrp_help.html bundled help page
(require 'org)
(org-link-set-parameters
 "help"
 :export
 (lambda (target description &optional backend info)
   (or description target)))
(org-link-set-parameters
 "file"
 :export
 (lambda (target description &optional backend info)
   (let ((target (org-html-encode-plain-text target))
	 (description (or description target)))
     (format "<a rel=\"nofollow noreferrer\" href=\"https://github.com/maxnikulin/linkremark/blob/master/%s\">%s</a>"
	     target description))))
(let ((input-file "README.org")
      (output-file "pages/lrp_help.html")
      (async nil)
      (subtree nil)
      (visible-only nil)
      (body-only nil)
      (org-html-prefer-user-labels t) ; avoid unstable ids
      (ext-plist
       '(:author nil
		 :exclude-tags ("skiphelp")
		 :with-drawers (not "skiphelp")
		 ;; :with-broken-links t
		 :html-doctype "html5"
		 :html-html5-fancy t
		 :html-head-include-scripts nil
		 :html-head-include-default-style nil
		 :html-head "
<link rel=\"fluid-icon\" sizes=\"128x128\" href=\"/icons/lr-128.png\">
<link rel=\"icon\" sizes=\"16x16\" href=\"/icons/lr-16.png\">
<link rel=\"icon\" sizes=\"24x24\" href=\"/icons/lr-24.png\">
<link rel=\"icon\" sizes=\"32x32\" href=\"/icons/lr-32.png\">
<link rel=\"icon\" sizes=\"48x48\" href=\"/icons/lr-48.png\">
<link rel=\"icon\" sizes=\"64x64\" href=\"/icons/lr-64.png\">
<script src=\"/common/bapi.js\"></script>
<script src=\"/common/lr_common.js\"></script>
<script src=\"/pages/lrp_navigation.js\"></script>
<script src=\"/pages/lrp_help.js\"></script>
<style>
body {
	background-color: white;
	max-width: 70ex;
	margin-inline: auto;
	padding-inline: 1ex;
	hyphens: auto;
	text-align: justify;
	/* Injected CSS (desktop theme?) could cause 1em smaller
	 * for body than for html element and result in inconsistent
	 * margins.
	 *
	 * Do not use `font-size` since it affects monospace font as well. */
	font: 1rem system-ui, sans-serif;
}
html {
	background-color: lightblue;
}
div.footdef > sup {
	float: left;
	display: block;
	margin-inline-end: 1ex;
}
img.logo {
	float: left;
	margin-inline-start: calc(max(-50vw + 50% + 2ex,-128px - 2ex));
}
pre.example, pre.src {
	white-space: pre-wrap;
}
</style>"
		 :html-validation-link nil
		 :html-preamble "<img src=\"/icons/lr-128.png\" alt=\"LinkRemark logo\" class=\"logo\">
<div><p>Check the project page
<a href=\"https://github.com/maxnikulin/linkremark\">https://<wbr>github.<wbr>com/<wbr>maxnikulin/<wbr>linkremark</a>.
for up to date version.</p>
<p>Open <a href=\"lrp_settings.html\" id=\"settings\" target=\"_blank\">settings</a> page.</p>
</div>
")))
  (with-current-buffer (find-file input-file)
    ;; Try to avoid execution of embedded code. It may be redefined
    ;; per file or even per src block, so it is unreliable.
    (let ((org-babel-default-header-args
	   (cons '(:eval . "never-export") org-babel-default-header-args)))
      (org-link-set-parameters
       "info"
       :export
       (lambda (path desc format)
	 "See `org-info-export'"
	 (let* ((parts (split-string path "#\\|::"))
		(manual (car parts))
		(node (or (nth 1 parts) "Top")))
	   (format "<code>info \"(%s) %s\"</code>" manual node))))
      (org-link-set-parameters
       "elisp"
       :export
       (lambda (path desc format)
	   (format "<code>%s</code>" desc)))
      (org-export-to-file 'html output-file
			  async subtree visible-only body-only ext-plist))))
