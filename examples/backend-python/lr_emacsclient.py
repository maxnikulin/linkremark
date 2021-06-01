#!/usr/bin/python3 -u

# Copyright (C) 2020 Max Nikulin
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

"""Native app for LinkRemark add-on that passes org-protocol URI to emacsclient

Simple native application (native messaging host, backend)
for LinkRemark browser extension
that allows to avoid desktop-wide org-protocol handler.
It requests capture result as org-protocol URI and directly passes
it to emacsclient. Without global org-protocol handler malicious
web pages with specially crafted org-protocol links (trying
to add some dangerous content to your org files) are harmless.

Requirements:
- Emacs server is running (``emacs --daemon`` or ``(server-start)``)
- Package org-protocol is loaded (added to ``org-modules``
  or ``(require 'org-protocol)``)
- Native messaging manifest is created (JSON file in browser-specific
  directory) to allow browser to run external application for particular
  add-on. Run this file with ``--manifest-chrome`` or ``--manifest-firefox``
  option to generate content of manifest file.
- Name of native backend (basename of JSON file and value of "name" field
  inside) is specified in LinkRemark settings, "native-messaging"
  communication channel is chosen.

You may wish to define ``linkremark-ensure-frame`` function
in Emacs to control whether new frame should be created for capture,
especially if Emacs daemon is running without any frame at all.
"""

import json
from http import HTTPStatus
import logging
import os.path
import subprocess
import sys
from lr_webextensions.jsonrpc import JsonRpcError, loop

APP_NAME = os.path.basename(sys.argv[0])
file_basename, file_ext = os.path.splitext(APP_NAME)
if file_ext and file_ext.lower() == ".py":
    APP_NAME = file_basename

APP_DESCRIPTION = "LinkRemark interface to emacsclient"

EXTENSION_FIREFOX = "linkremark@maxnikulin.github.io"
EXTENSION_CHROME = "mgmcoaemjnaehlliifkgljdnbpedihoe"

EMACSCLIENT = "emacsclient"
EMACSCLIENT_ARGS = ["--quiet"]
EMACSCLIENT_CHECK_ORG_PROTOCOL = [
        "--eval", "(and (memq 'org-protocol features) 'org-protocol)"]
EMACSCLIENT_ENSURE_FRAME = [
        "--eval", """\
(if (and (symbolp 'linkremark-ensure-frame) (fboundp 'linkremark-ensure-frame))
    (linkremark-ensure-frame)
  (or (memq 'x (mapcar #'framep (frame-list)))
      (make-frame '((name . "LinkRemark") (window-system . x)))))"""]

USAGE = """\
Usage: {0} IGNORED_ARGS_PASSED_BY_BROWSER...
   or: {0} {{--manifest-chrome|--manifest-firefox}} >MANIFEST_DIR/NAME.json
   or: {0} {{-h|--help}}

  -h, --help    print this message
  --manifest-chrome
  --manifest-firefox
                print native messaging manifest for Chrome or Firefox.
                Output should be redirected to NAME.json file where NAME
                is the same as the similar field in the manifest
                ({APP_NAME}.json).
                in a browser-specific directory (system-wide, user,
                or browser profile configuration), e.g.
                ~/.mozilla/native-messaging-hosts/{APP_NAME}.json
                See for details:
                https://developer.chrome.com/docs/apps/nativeMessaging/#native-messaging-host-location
                https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests
                https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging#app_manifest
"""


def run(*args, error_message="", **kwargs):
    try:
        return subprocess.run(*args, **kwargs)
    except subprocess.SubprocessError as ex:
        data = {"command": args[0][0]}
        for attr in ("returncode", "stderr", "stdout"):
            value = getattr(ex, attr, None)
            if isinstance(value, bytes):
                value = value.decode('UTF-8').strip()
            if value is not None and value != "":
                data[attr] = value
        message = (error_message or "External process failed")
        code = HTTPStatus.INTERNAL_SERVER_ERROR
        raise JsonRpcError(message, code, data)


def check_emacs_org_protocol():
    try:
        cmd = [EMACSCLIENT] + EMACSCLIENT_ARGS + EMACSCLIENT_CHECK_ORG_PROTOCOL
        res = run(
            cmd, capture_output=True, check=True,
            error_message="Failed check if org-protocol is available")
        if not res.stdout.startswith(b"org-protocol"):
            logging.error(
                "org-protocol is not loaded: %s stdout: %s stderr: %s",
                cmd, res.stdout, res.stderr)
            raise JsonRpcError(
                "org-protocol is not loaded",
                HTTPStatus.INTERNAL_SERVER_ERROR)
        return True
    except FileNotFoundError:
        logging.error("emacsclient command not found", exc_info=True)
        raise JsonRpcError(
            f"{EMACSCLIENT} is not in PATH",
            HTTPStatus.INTERNAL_SERVER_ERROR)


def run_emacsclient(url):
    cmd = [EMACSCLIENT] + EMACSCLIENT_ARGS + EMACSCLIENT_ENSURE_FRAME
    run(
        cmd, check=True, capture_output=True,
        error_message="Ensure Emacs frame for capture failed")

    cmd = [EMACSCLIENT] + EMACSCLIENT_ARGS + ["--", url]
    run(cmd, check=True, capture_output=True,
        error_message="Open org-protocol URI failed")
    return True


# Handler().capture(format='object', version='0.2', data={
#     'body': 'org-protocol:/capture?url=https%3A%2F%2Forgmode.org%2F&title=Org%20Mode&body=Web%20site',
# })
class Handler:
    _format = "org-protocol"
    _version = "0.2"

    def hello(self, version=None, formats=None):
        """
        >>> Handler().hello(
        ...     formats=[
        ...         {"format": "object", "version": "0.2"},
        ...         {"format": "org", "version": "0.2"},
        ...         {"format": "org-protocol", "version": "0.2"},
        ...     ],
        ...     version="0.2",
        ... );
        {'format': 'org-protocol', 'version': '0.2'}
        """

        # Extension ID could be obtained from `sys.argv`.
        if not isinstance(formats, list):
            return JsonRpcError(
                "hello: formats are not specified",
                HTTPStatus.BAD_REQUEST)
        data = {'format': self._format, 'version': self._version}
        for descr in formats:
            if not isinstance(descr, dict):
                return JsonRpcError(
                    "hello: format descriptor is not an object",
                    HTTPStatus.BAD_REQUEST)
            if descr['format'] == self._format and descr['version'] == self._version:
                return data
        return JsonRpcError(
            "hello: supported format not found",
            HTTPStatus.NOT_IMPLEMENTED,
            data)

    # In the case of tab group only the first link is stored.
    def capture(self, data=None, format=None, version=None):
        error = self._check_format_version(data, format, version)
        if error:
            return error
        check = check_emacs_org_protocol()
        if check is not True:
            return check
        return run_emacsclient(data)

    def _check_format_version(self, data, format, version):
        if format != self._format or version != self._version:
            return JsonRpcError(
                "capture: unsupported format",
                HTTPStatus.NOT_IMPLEMENTED, {
                    'expected': {
                        'format': self._format, 'version': self._version
                    },
                    'received': {
                        'format': format, 'version': version
                    }
                })
        if not isinstance(data, str):
            return JsonRpcError(
                'capture: data is not a String (URI)',
                HTTPStatus.BAD_REQUEST, data)
        return None


def exe_realpath():
    return os.path.realpath(sys.argv[0])


def manifest_chrome():
    manifest = {
        "name": APP_NAME,
        "description": APP_DESCRIPTION,
        "path": exe_realpath(),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{EXTENSION_CHROME}/"],
    }
    json.dump(manifest, sys.stdout, indent=2)
    print("")


def manifest_firefox():
    manifest = {
        "name": APP_NAME,
        "description": APP_DESCRIPTION,
        "path": exe_realpath(),
        "type": "stdio",
        "allowed_extensions": [EXTENSION_FIREFOX],
    }
    json.dump(manifest, sys.stdout, indent=2)
    print("")


def main():
    # argparse is intentionally avoided here to avoid
    # risk of excessively clever actions.
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    if arg == "-h" or arg == "-help" or arg == "--help":
        print(USAGE.format(*sys.argv, APP_NAME=APP_NAME))
        print(__doc__)
    elif arg == "--manifest-chrome" or arg == "-manifest-chrome":
        manifest_chrome()
    elif arg == "--manifest-firefox" or arg == "-manifest-firefox":
        manifest_firefox()
    else:
        loop(Handler())


if __name__ == '__main__':
    main()
