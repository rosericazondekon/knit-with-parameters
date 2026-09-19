#!/usr/bin/env python3
"""Resolve consented Python parameter expressions from a JSON request.

This helper deliberately evaluates arbitrary Python expressions.  Its caller must
obtain user consent before invoking it; this file is not a sandbox.
"""

import contextlib
import datetime
import io
import json
import math
import sys
from collections.abc import Mapping

_SAFE_INTEGER_LIMIT = 9007199254740991


def _invalid_constant(_value):
    raise ValueError("JSON constants must be finite")


def _read_request(path):
    with open(path, "r", encoding="utf-8") as request_file:
        request = json.load(request_file, parse_constant=_invalid_constant)
    if not isinstance(request, dict) or set(request) != {"expressions"}:
        raise ValueError("request must contain only an expressions object")
    expressions = request["expressions"]
    if not isinstance(expressions, dict):
        raise ValueError("expressions must be an object")
    for name, source in expressions.items():
        if not isinstance(name, str) or not name:
            raise ValueError("expression names must be non-empty strings")
        if not isinstance(source, str):
            raise ValueError("expression sources must be strings")
    return expressions


def _json_value(value, seen=None):
    """Convert only values supported by the host parameter protocol."""
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, datetime.datetime):
        return value.isoformat()
    if isinstance(value, datetime.date):
        return value.isoformat()
    if isinstance(value, int):
        if not -_SAFE_INTEGER_LIMIT <= value <= _SAFE_INTEGER_LIMIT:
            raise OverflowError("integer is outside the JavaScript safe range")
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("number is not finite")
        return value
    if isinstance(value, Mapping):
        raise TypeError("mappings are not supported")
    if isinstance(value, (list, tuple)):
        if seen is None:
            seen = set()
        value_id = id(value)
        if value_id in seen:
            raise TypeError("recursive sequences are not supported")
        seen.add(value_id)
        try:
            return [_json_value(item, seen) for item in value]
        finally:
            seen.remove(value_id)
    raise TypeError("value type is not supported")


def _evaluate(name, source):
    namespace = {
        "datetime": datetime,
        "date": datetime.date,
        "timedelta": datetime.timedelta,
    }
    # Expressions may intentionally import or invoke code which writes output.
    # The protocol communicates exclusively through the response file.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        value = eval(source, namespace)
    return _json_value(value)


def _error_for(name, error):
    return {"error": "Parameter {!r} could not be resolved ({}).".format(name, type(error).__name__)}


def _write_response(path, response):
    with open(path, "w", encoding="utf-8", newline="\n") as response_file:
        json.dump(response, response_file, allow_nan=False, ensure_ascii=False, separators=(",", ":"))
        response_file.write("\n")


def main(argv):
    if len(argv) != 3:
        return 2
    request_path, response_path = argv[1], argv[2]
    try:
        expressions = _read_request(request_path)
    except Exception as error:  # Input errors must not leak parser details.
        try:
            _write_response(response_path, {"error": "Invalid request ({}).".format(type(error).__name__)})
        except Exception:
            pass
        return 1

    values = {}
    for name, source in expressions.items():
        try:
            values[name] = _evaluate(name, source)
        except Exception as error:
            _write_response(response_path, _error_for(name, error))
            return 1

    _write_response(response_path, {"values": values})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
