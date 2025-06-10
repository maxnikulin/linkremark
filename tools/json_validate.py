#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later

# json_validate.py - report syntax errors in JSON files
#
# Copyright (C) 2025 Max Nikulin
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.
"""
Try to parse JSON files and report syntax errors

This is a simple wrapper for Python ``json.load()`` function. Unlike

     python3 -m json.tool FILE 1>/dev/null

this tool uses "FILE:LINE:COLUMN: MESSAGE" format similar to compilers.
"""

__version__ = "0.1.0"
__author__ = "Max Nikulin"
__license__ = "GPLv3+"
__copyright__ = "Copyright (C) 2025 Max Nikulin"


from argparse import ArgumentParser
import json
import sys


def main():
    parser = ArgumentParser(
        description="Report syntax errors in JSON files in compiler format.")
    parser.add_argument(
        '--verbose', '-v', action='store_true',
        help='be verbose, print names of processed files')
    # Perhaps ``argparse.FileType`` is not the best option for list of files.
    parser.add_argument('files', nargs='*')
    options = parser.parse_args()

    retval = 0
    for name in options.files or ('-'):
        try:
            if options.verbose:
                print(f"Parse {name!r}")
            if name == '-':
                file = sys.stdin
            else:
                file = open(name, 'r', encoding='utf-8')

            with file:
                json.load(file, object_pairs_hook=lambda _: None)
        except json.JSONDecodeError as exc:
            retval = 1
            print(
                f"{name}:{exc.lineno}:{exc.colno}: {exc.msg}",
                file=sys.stderr)
        except ValueError as exc:
            # e.g. ``UnicodeDecodeError``
            retval = 1
            print(
                f"{name}: {exc}",
                file=sys.stderr)
        except Exception as exc:
            retval = 1
            print(
                f"{name}: {exc}",
                file=sys.stderr)

    return retval


if __name__ == '__main__':
    try:
        sys.exit(main())
    except BrokenPipeError as exc:
        print(exc, file=sys.stderr)
        sys.exit(exc.errno)
