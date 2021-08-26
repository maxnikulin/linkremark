
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

import logging
import sys
from typing import Dict, Any

from . import native_messaging

# http://www.jsonrpc.org/specification
JSONRPC_KEY = 'jsonrpc'
JSONRPC_VERSION = '2.0'
ID_KEY = 'id'
RESULT_KEY = 'result'
ERROR_KEY = 'error'
METHOD_KEY = 'method'
PARAMS_KEY = 'params'
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INTERNAL_ERROR = -32603

go_net_rpc_jsonrpc_compat = True

logger = logging.getLogger("lr_webextensions.jsonrpc")


class JsonRpcError(Exception):
    def __init__(self, message, code, data=None):
        super(JsonRpcError, self).__init__(message, code, data)

    @property
    def message(self):
        return self.args[0]

    @property
    def code(self):
        return self.args[1]

    @property
    def data(self):
        return self.args[2]

    def make_response(self, request_id):
        return make_error(
            request_id=request_id,
            code=self.code, message=self.message, data=self.data)


def loop(handler, input_file=sys.stdin.buffer, output_file=sys.stdout.buffer):
    for message in native_messaging.message_source(input_file):
        result = None
        try:
            result = process(handler, message)
            native_messaging.send_message(output_file, result)
        except Exception:
            message = "exception while processing request"
            logger.exception(message, exc_info=True)
            result = make_error(
                request_id=result.get('id', None) if result else None,
                code=INTERNAL_ERROR, message=message)
            native_messaging.send_message(output_file, result)


def process(handler, message: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(message, dict):
        error = f'Expected dict (Object), got {type(message)}'
        logger.warning(error)
        return make_invalid_request_response(None, {'type': error})

    request_id = message.get(ID_KEY)
    log_id = [message[key] for key in [ID_KEY, METHOD_KEY] if key in message]
    missed = [
            key for key in [JSONRPC_KEY, ID_KEY, METHOD_KEY]
            if key not in message]
    if len(missed) > 0:
        error = "Required fields are missed"
        logger.warning("request %r: %s: %s", log_id, error, missed)
        return make_invalid_request_response(
            request_id, {'type': error, 'arg': missed})

    version = message[JSONRPC_KEY]
    if version != JSONRPC_VERSION:
        error = f'JSON-RPC version must be {JSONRPC_VERSION}'
        logger.warning('request %r: %s got: %r', log_id, error, version)
        return make_invalid_request_response(
            request_id, {'type': error, 'arg': version})

    method = message[METHOD_KEY]
    method_handler = handler
    for attr in method.split('.'):
        if not attr:
            error = 'Empty method component'
            logger.warning('request %r: %s', log_id, error)
            return make_invalid_request_response(request_id, {'type': error})
        if attr.startswith('_') or not hasattr(method_handler, attr):
            logger.warning('request %r: method not found', log_id)
            return make_method_not_found(request_id, method)
        method_handler = getattr(method_handler, attr)

    if not callable(method_handler):
        logger.warning('request %r: method not callable', log_id)
        return make_method_not_found(request_id, method)

    try:
        result = None
        params = message.get(PARAMS_KEY)
        if go_net_rpc_jsonrpc_compat and isinstance(params, list) and len(params) == 1:
            params = params[0]
        if params is None:
            result = method_handler()
        elif isinstance(params, dict):
            result = method_handler(**params)
        elif isinstance(params, list):
            result = method_handler(*params)
        else:
            error = "params is neither Object nor Array"
            logger.warning("request %r: %s: %s", log_id, error, type(params))
            return make_invalid_request_response(
                    request_id, {'type': error, 'arg': str(type(params))})

        if isinstance(result, JsonRpcError):
            return result.make_response(request_id)

        return make_response(request_id, result)

    except JsonRpcError as ex:
        response = ex.make_response(request_id)
        logger.error("%s: %r", method, response)
        return response

    except Exception:
        error = 'Exception while calling handler'
        logger.exception('request %r: %s', log_id, error, exc_info=True)
        return make_error(
            request_id=request_id, code=INTERNAL_ERROR, message=error)

    error = 'Internal error, code should be unreachable'
    logger.error('request %r: %s', log_id, error)
    return make_error(
            request_id=request_id, code=INTERNAL_ERROR, message=error)


# Spec 5
def make_response(request_id, result):
    return {
        JSONRPC_KEY: JSONRPC_VERSION,
        ID_KEY: request_id,
        RESULT_KEY: result
    }


# Spec 5.1
def make_error(request_id, code, message, data=None):
    error = {'code': code, 'message': message}
    if data is not None:
        error["data"] = data
    return {
        JSONRPC_KEY: JSONRPC_VERSION, ID_KEY: request_id, ERROR_KEY: error,
    }


def make_invalid_request_response(request_id, data):
    return make_error(request_id, INVALID_REQUEST, "Invalid Request", data)


def make_method_not_found(request_id, method):
    return make_error(request_id, METHOD_NOT_FOUND, "Method not found", {
        'name': method
    })
