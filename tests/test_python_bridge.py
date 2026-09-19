"""Tests for the consent-gated Python expression resolver."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "bridge.py"


class PythonBridgeTests(unittest.TestCase):
    def resolve(self, request):
        with tempfile.TemporaryDirectory() as directory:
            request_path = Path(directory) / "request.json"
            response_path = Path(directory) / "response.json"
            request_path.write_text(json.dumps(request), encoding="utf-8")
            process = subprocess.run(
                [sys.executable, str(SCRIPT), str(request_path), str(response_path)],
                capture_output=True,
                text=True,
                check=False,
            )
            response = json.loads(response_path.read_text(encoding="utf-8"))
        return process, response

    def test_date_datetime_and_timedelta_shortcuts(self):
        process, response = self.resolve({"expressions": {
            "day": "date(2024, 1, 2)",
            "moment": "datetime.datetime(2024, 1, 2, 3, 4, 5)",
            "next_day": "date(2024, 1, 1) + timedelta(days=1)",
        }})
        self.assertEqual(process.returncode, 0)
        self.assertEqual(response, {"values": {
            "day": "2024-01-02", "moment": "2024-01-02T03:04:05", "next_day": "2024-01-02",
        }})

    def test_lists_tuples_and_null(self):
        process, response = self.resolve({"expressions": {"items": "[None, (True, 'x'), 3.5]"}})
        self.assertEqual(process.returncode, 0)
        self.assertEqual(response, {"values": {"items": [None, [True, "x"], 3.5]}})

    def test_malformed_input_is_rejected(self):
        process, response = self.resolve({"expressions": []})
        self.assertNotEqual(process.returncode, 0)
        self.assertEqual(response, {"error": "Invalid request (ValueError)."})

    def test_arbitrary_expression_code_is_available_after_consent(self):
        # This helper is intentionally not a sandbox; host consent is required.
        process, response = self.resolve({"expressions": {"answer": "__import__('math').factorial(5)"}})
        self.assertEqual(process.returncode, 0)
        self.assertEqual(response, {"values": {"answer": 120}})

    def test_secret_and_evaluation_output_are_not_leaked(self):
        secret = "do-not-disclose-947"
        process, response = self.resolve({"expressions": {
            "token": "(__import__('sys').stdout.write('" + secret + "'), 1 / 0)[1]"
        }})
        self.assertNotEqual(process.returncode, 0)
        self.assertEqual(response, {"error": "Parameter 'token' could not be resolved (ZeroDivisionError)."})
        self.assertNotIn(secret, process.stdout + process.stderr + json.dumps(response))

    def test_nonfinite_and_unsafe_integers_are_rejected(self):
        for expression, exception in [("float('nan')", "ValueError"), ("9007199254740992", "OverflowError")]:
            with self.subTest(expression=expression):
                process, response = self.resolve({"expressions": {"number": expression}})
                self.assertNotEqual(process.returncode, 0)
                self.assertEqual(response, {"error": "Parameter 'number' could not be resolved (" + exception + ")."})

    def test_unsupported_objects_and_mappings_are_rejected(self):
        for expression in ("{'key': 'value'}", "object()"):
            with self.subTest(expression=expression):
                process, response = self.resolve({"expressions": {"value": expression}})
                self.assertNotEqual(process.returncode, 0)
                self.assertEqual(response, {"error": "Parameter 'value' could not be resolved (TypeError)."})


if __name__ == "__main__":
    unittest.main()
