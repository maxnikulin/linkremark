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

"""Example of native messaging backend for LinkRemark browser extension

It asks data in "object" format, extracts URL from the captured frame
and launches org-protocol store-link handler.

Use ``emacs-client`` instead of ``xdg-open`` to avoid hassle with
setting up of protocol handler in desktop environment.

OS: Linux.
"""

from http import HTTPStatus
import logging
from subprocess import run, SubprocessError
from urllib.parse import urlencode
from lr_webextensions.jsonrpc import JsonRpcError, loop


def org_protocol_urlencode(protocol, *args, **kwargs):
    """ ``urllib.parse.urlencode`` with space encoded as ``%20``

    "+" as space representation is not supported by org-protocol

    >>> org_protocol_urlencode('store-link', {
    ...     'url': 'https://orgmode.org/',
    ...     'title': 'Org Mode',
    ... })
    'org-protocol:/store-link?url=https%3A%2F%2Forgmode.org%2F&title=Org%20Mode'
    """
    query = urlencode(*args, **kwargs).replace('+', '%20')
    return f'org-protocol:/{protocol}?{query}'


def call_org_protocol_store_link(url, title):
    arg = org_protocol_urlencode(
        'store-link', {'url': url, 'title': title}, safe='')
    try:
        run(['xdg-open', arg], check=True)
        return True
    except SubprocessError:
        logging.error("subprocess failed", exc_info=True)
        return JsonRpcError(
            "Protocol handler failed",
            HTTPStatus.INTERNAL_SERVER_ERROR)


# Handler().capture(format='object', version='0.1', data=[{
#     'url': [{'value': 'https://orgmode.org/', 'keys': ['window.location']}],
#     'title': [{'value': 'Org Mode', 'keys': ['document.title']}],
# }])
class Handler:
    _format = "object"
    _version = "0.1"
    _url_score_map = {
        'link.canonical': 100,
        'og:url': 30,
        'window.location': 10,
    }

    def hello(self, version=None, formats=None):
        """
        >>> Handler().hello(
        ...    formats={"object": ["0.1"], "org": ["0.1"]},
        ...    version="0.1",
        ... );
        {'format': 'object', 'version': '0.1'}
        """

        # Extension ID could be obtained from `sys.argv`.
        if not isinstance(formats, dict):
            return JsonRpcError(
                "hello: formats are not specified",
                HTTPStatus.BAD_REQUEST)
        versions = formats.get(self._format)
        data = {'format': self._format, 'version': self._version}
        if not isinstance(versions, list) or self._version not in versions:
            return JsonRpcError(
                "hello: supported format not found",
                HTTPStatus.NOT_IMPLEMENTED,
                data)
        return data

    def capture(self, data=None, format=None, version=None):
        error = self._check_format_version(data, format, version)
        if error:
            return error
        try:
            url, title = self._get_frame_link(data[0])
        except ValueError as ex:
            return JsonRpcError(
                "capture: " + str(ex),
                HTTPStatus.NOT_ACCEPTABLE)

        return call_org_protocol_store_link(url, title)

    def _check_format_version(self, data, format, version):
        if (
                not isinstance(data, list) or
                not len(data) > 0 or
                not isinstance(data[0], dict)):
            return JsonRpcError(
                "capture: data is not Array or its element is not Object",
                HTTPStatus.BAD_REQUEST)
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
        return None

    def _get_frame_link(self, frame):
        """
        >>> Handler()._get_frame_link({
        ...     'url': [{
        ...         'value': 'https://orgmode.org/',
        ...         'keys': ['window.location']
        ...     }],
        ...     'title': [{'value': 'Org Mode', 'keys': ['document.title']}],
        ... })
        ('https://orgmode.org/', 'Org Mode')
        """
        # TODO Inside the frame there could be
        # a link (linkUrl) or image (srcUrl)
        best_score = 0
        url = None
        for variant in frame.get('url', []):
            score = sum(self._url_score(x) for x in variant.get('keys', []))
            if score > best_score:
                best_score = score
                url = variant['value']
        titleVariants = frame.get('title')
        title = titleVariants[0]['value'] if len(titleVariants) > 0 else None
        if not url:
            raise ValueError("url not found")
        return url, title

    def _url_score(self, source):
        """
        >>> Handler()._url_score('link.canonical')
        100
        >>> Handler()._url_score('something.else')
        1
        """
        return self._url_score_map.get(source, 1)


if __name__ == '__main__':
    loop(Handler())
