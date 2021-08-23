#!/usr/bin/python3 -u

# Copyright (C) 2020-2021 Max Nikulin
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

Demonstrate how to create custom formatters by requesting data
in "object" format. This application extracts URL from the captured frame
and launches org-protocol store-link handler.

Use ``emacs-client`` instead of ``xdg-open`` have a bit more secure
configuration and to avoid hassle with setting up of protocol handler
in desktop environment.

See also ``lr_emacsclient.py`` minimal useful backend that requests
formatted capture as org-protocol URI and passes it to emacsclient.
It is possible to pass raw JSON to Emacs as org-protocol URI by advertising
``{"format": "org-protocol", "version": "0.2", "options": {"format": "object", "version": "0.2"}}``
desired format.

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


# Handler().capture(format='object', version='0.2', data=[{
#     'url': [{'value': 'https://orgmode.org/', 'keys': ['window.location']}],
#     'title': [{'value': 'Org Mode', 'keys': ['document.title']}],
# }])
class Handler:
    _format = "object"
    _version = "0.2"
    _url_score_map = {
        'link.canonical': 100,
        'og:url': 30,
        'window.location': 10,
    }

    def hello(self, version=None, formats=None):
        """
        >>> Handler().hello(
        ...     formats=[
        ...         {"format": "object", "version": "0.2"},
        ...         {"format": "org", "version": "0.2"},
        ...     ],
        ...     version="0.2",
        ... );
        {'format': 'object', 'version': '0.2'}
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
    def capture(self, data=None, format=None, version=None, error=None, **kwargs):
        kwargs.pop("options", None)
        if kwargs:
            return JsonRpcError(
                "capture: unsupported fields",
                HTTPStatus.BAD_REQUEST, {"fields": list(kwargs.keys())})

        format_error = self._check_format_version(data, format, version)
        if format_error:
            return format_error
        try:
            url, title = self._get_frame_link(data["body"]["elements"][0])

            if error:
                return {"preview": True, "status": "preview"}

        except ValueError as ex:
            return JsonRpcError(
                "capture: " + str(ex),
                HTTPStatus.NOT_ACCEPTABLE)

        if call_org_protocol_store_link(url, title):
            return {"preview": False, "status": "success"}
        else:
            return {"preview": True, "status": "preview"}

    def _check_format_version(self, data, format, version):
        if (
                not isinstance(data, dict) or
                "body" not in data or
                not isinstance(data["body"], dict) or
                "elements" not in data["body"] or
                not isinstance(data["body"]["elements"], list) or
                not len(data["body"]["elements"]) > 0 or
                not isinstance(data["body"]["elements"][0], dict)):
            return JsonRpcError(
                "capture: data is not Array or its element is not Object",
                HTTPStatus.BAD_REQUEST, data)
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
