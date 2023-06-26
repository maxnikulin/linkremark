#!/usr/bin/env python3
import argparse
from collections import defaultdict
from contextlib import ExitStack
import email.utils
from http import HTTPStatus
import http.server
import mimetypes
import os
from pathlib import Path
import shutil
import stat
import sys
import threading
import urllib.parse

# Copyright (C) 2023 Max Nikulin
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

"""HTTP server for local tests of cross-origin frames and browser extensions

Web pages for ``<iframe>`` elements may be either served from
different ports or assuming either host name lookup configuration
or overrides in browsers.
"""

template_top = """<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>LR Test: Cross-Origin Frames: Top</title>
    <meta name="description"
        content="Top-level frame for cross-origin permissions test.">
    <style>
    iframe {{
        max-width: 80%;
        max-height: 80vh;
    }}
    </style>
  </head>
  <body>
    <h1>LR Test: Cross-Origin Frames: Top Level Frame</h1>
    <div>
      <iframe src="{urlmap[mid]}" width="800" height="1200">
        HTML Document for intermediate should be loaded here.
      </iframe>
    </div>
  </body>
</html>
"""

template_mid = """<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>LR Test: Cross-Origin Frames: Intermediate</title>
    <meta name="description"
        content="Intermediate frame for cross-origin permissions test.">
    <style>
    iframe {{
        max-width: 80%;
        max-height: 40vh;
    }}
    </style>
  </head>
  <body>
    <h1>LR Test: Cross-Origin Frames: Intermediate Frame</h1>
    <div>
      <iframe src="{urlmap[inner]}" width="640" height="480">
        Inner frame with a HTML document should be loaded here.
      </iframe>
    </div>{fragment_file}
  </body>
</html>
"""

template_inner = """<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>LR Test: Cross-Origin Frames: Inner</title>
    <meta name="description"
        content="Inner frame for cross-origin permissions test.">
  </head>
  <body>
    <h1>LR Test: Cross-Origin Frames: Inner Frame</h1>
  </body>
</html>
"""

fragment_file = """
    <iframe src="{urlmap[file]}" width="640" height="480">
      A file should be loaded here
    </iframe>
"""


class MappingRequestHandler(http.server.BaseHTTPRequestHandler):
    mapping = {}
    mtime = email.utils.formatdate(os.stat(__file__).st_mtime, usegmt=True)

    def do_GET(self):
        parts = urllib.parse.urlsplit(self.path)
        content = self.mapping.get(parts.path)
        if isinstance(content, (str, bytes)):
            self._send_string(content)
        elif isinstance(content, Path):
            self._send_file(content)
        elif content is None:
            self.send_error(HTTPStatus.NOT_FOUND)
        else:
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR)
        return

    def _send_string(self, content):
        is_str = isinstance(content, str)
        if is_str:
            encoded = content.encode("UTF-8", 'surrogateescape')
        else:
            encoded = content

        self.send_response(HTTPStatus.OK)
        if is_str:
            self.send_header("Content-Type", "text/html; charset=UTF-8")
        else:
            self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Last-Modified", self.mtime)
        self.end_headers()

        self.wfile.write(encoded)

    def _send_file(self, path):
        # ``str(path)`` for Python-3.6 compatibility.
        mime_type, _ = mimetypes.guess_type(str(path))
        try:
            st = path.stat()
        except FileNotFoundError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        except Exception:
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if not stat.S_ISREG(st.st_mode):
            self.send_error(HTTPStatus.FORBIDDEN)
            return

        self.send_response(HTTPStatus.OK)
        if not mime_type:
            mime_type = "application/octet-stream"
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(st.st_size))
        self.send_header(
            "Last-Modified", email.utils.formatdate(st.st_mtime, usegmt=True))
        self.end_headers()

        with open(path, "rb") as f:
            shutil.copyfileobj(f, self.wfile)


def make_mapping_handler(path_content_map):
    class _CustomMappingRequestHandler(MappingRequestHandler):
        mapping = path_content_map

    return _CustomMappingRequestHandler


def make_argument_parser():
    parser = argparse.ArgumentParser(
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
        epilog="""The following substitutions are available
        for ``--url-*`` arguments: ``%(hostname)s``, ``%(port)s``,
        ``%(host)s`` (``%(hostname)s:%(port)s``), ``%(file)s``.""")
    parser.add_argument(
        '--first-ip', metavar='NUMBER', type=int, default=1, dest="first",
        help="Initial number to substitute into IP pattern")
    parser.add_argument(
        '--multiport', action='store_true', default=False,
        help="""serve each page on its own port
        starting from the PORT argument.
        Notice that Chrome does not show port number in permission request
        popups.""")
    parser.add_argument(
        '--bind', metavar="IP_PATTERN", default="127.0.0.%s",
        help="""Pattern to generate bind addresses for servers.
        "%%s" is replaced by numbers starting from "--first-ip".
        If it is omitted listen the same IP. Either use "--multiport",
        or specify "--url-*" options and add IP addresses to the "hosts"
        file or DNS server configuration.
        In Firefox you may use ``network.dns.forceResolve`` preference.
        In Chromium add ``--host-resolver-rules='MAP * 127.0.0.1'``.""")
    parser.add_argument(
        '--hostname', metavar="PATTERN",
        help="""Pattern to generate "hostname" substitutions to "--url-*"
        arguments. "%%s" is replaced by subsequent numbers starting
        from "--first-ip" (default: '--bind' value)""")
    parser.add_argument(
        '--url-top', metavar='URL', dest='url_top',
        default='//%(host)s/',
        help='Top page URL that contains an iframe for ``--url-mid``.')
    parser.add_argument(
        '--url-mid', metavar='URL', dest='url_mid',
        default='//%(host)s/intermediate/',
        help="""URL to serve an iframe for top page
        and containing an iframe for ``--url-inner``.""")
    parser.add_argument(
        '--url-inner', metavar='URL', dest='url_inner',
        default='//%(host)s/inner/',
        help="""URL to serve an iframe inside ``--url-mid`` iframe.
        If ``--file`` is specified then this page
        contains an iframe with the specified file.""")
    parser.add_argument(
        '--url-file', metavar='URL', dest='url_file',
        default='//%(host)s/file/%(file)s',
        help='URL to serve the file specified by ``--file``.')
    parser.add_argument(
        '--file', metavar="FILE", type=Path, dest='file_file',
        help="Create a frame for the file, e.g. PDF")
    parser.add_argument(
        'port', default=8000, type=int, nargs='?',
        help='TCP port to listen [default: 8000]')
    return parser


def args_to_serve_params(args):
    multiip = args.bind.find("%s") >= 0
    hostname_pattern = args.hostname or args.bind
    multihost = hostname_pattern.find("%s") >= 0

    port = args.port
    octet = args.first
    host_num = octet
    urlmap = {}
    bind_url_map = defaultdict(dict)
    page_list = ['top', 'mid', 'inner']
    file_name = None
    if args.file_file:
        page_list.append("file")
        file_name = args.file_file.name
    for page in page_list:
        hostname = (hostname_pattern % host_num) if multihost else hostname_pattern
        ip = (args.bind % octet) if multiip else args.bind
        url_template = getattr(args, 'url_' + page)
        host = f"{hostname}:{port}"
        url = url_template % dict(
            hostname=hostname,
            host=host,
            port=port,
            file=file_name)
        urlmap[page] = url
        # TODO assert that port is the same as ":.*" part
        # in ``urllib.parse.parseurl(url).netloc``.
        # The function does not recognize port as a separate component.
        address = (ip, port)
        bind_url_map[address][page] = url
        if args.multiport:
            port += 1
        if multiip:
            octet += 1
        if multihost:
            host_num += 1

    template_args = {"urlmap": urlmap}
    if args.file_file:
        template_args["fragment_file"] = fragment_file.format_map(
            template_args)
    else:
        template_args["fragment_file"] = ""

    return bind_url_map, template_args


def serve(bind_url_map, content_map):
    with ExitStack() as stack:
        server_list = []
        for address, url_map in bind_url_map.items():
            page_mapping = {}
            for page, url in url_map.items():
                split = urllib.parse.urlsplit(url)
                path = split.path
                scheme = split.scheme or 'http'
                page_mapping[path] = content_map[page]

                print(f"Serving at http://{address[0]}:{address[1]}{path} {scheme}:{url}")

            handler_class = make_mapping_handler(page_mapping)
            server = stack.enter_context(
                http.server.HTTPServer(address, handler_class))
            if "top" in url_map:
                server_top = server
            else:
                server_list.append(server)

        try:
            for httpd in server_list:
                thread = threading.Thread(target=httpd.serve_forever)
                thread.daemon = True
                thread.start()

            server_top.serve_forever()
        except KeyboardInterrupt:
            sys.exit(0)


if __name__ == '__main__':
    parser = make_argument_parser()
    args = parser.parse_args()
    bind_url_map, template_args = args_to_serve_params(args)
    content_map = {}
    loc = locals()

    for page in (k for m in bind_url_map.values() for k in m.keys()):
        template = loc.get("template_" + page)
        if template:
            target = template.format_map(template_args)
        else:
            target = getattr(args, "file_" + page, None)

        if not target:
            raise ValueError(f"{page} content is not specified")
        content_map[page] = target

    serve(bind_url_map, content_map)
