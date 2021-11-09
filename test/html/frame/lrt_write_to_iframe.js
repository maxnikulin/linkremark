"use strict";
var iframeDocument = document.getElementById("iframe").contentDocument;
iframeDocument.open();
iframeDocument.write(
  "<!DOCTYPE html><html><head><meta charset='utf-8'>\n<title>LR Iframe</title></head>\n<body><h1>LR Iframe</h1></body></html>");
iframeDocument.close();
