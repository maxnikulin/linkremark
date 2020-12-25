
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
"""Helpers for WebExtensions native messaging communication

See
`https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Native_messaging`__

``input_file`` is usually ``sys.stdin.buffer``,
``outfile`` is ``sys.stdout.buffer``.
"""

import json
import struct

MESSAGE_SIZE_LIMIT = 1024*1024


#: Read messages from a file-like object and decode them
def message_source(input_file):
    while True:
        raw_length = input_file.read(4)
        if len(raw_length) == 0:
            return
        message_length = struct.unpack('@I', raw_length)[0]
        if message_length > MESSAGE_SIZE_LIMIT:
            raise ValueError("Message size limit exceeded", message_length)
        message = input_file.read(message_length).decode('utf-8')
        yield json.loads(message)


#: Encode a message for transmission, given its content
def encode_message(message):
    encoded = json.dumps(message, ensure_ascii=False).encode('utf-8')
    raw_length = struct.pack('@I', len(encoded))
    return raw_length, encoded


#: Serialize message, encode it, and write it to a file-like object
def send_message(output_file, message):
    raw_length, encoded = encode_message(message)
    output_file.write(raw_length)
    output_file.write(encoded)
    output_file.flush()
