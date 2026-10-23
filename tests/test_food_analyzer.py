"""Food analyzer request shape + response handling, with a fake Anthropic client."""

import json
import sys
import types
import unittest
from unittest import mock

from domains.food import analyzer


def fake_sdk(stop_reason="end_turn", payload=None):
    calls = []
    reply = json.dumps(payload or {
        "items": [
            {"name": "truita de patates", "grams": 150, "kcal": 250, "protein_g": 10, "carbs_g": 15,
             "fat_g": 16, "saturated_fat_g": 3, "fiber_g": 1.5, "sugar_g": 1},
            {"name": "pa amb tomàquet", "grams": None, "kcal": 180, "protein_g": 5, "carbs_g": 30,
             "fat_g": 5, "saturated_fat_g": 0.8, "fiber_g": 2, "sugar_g": 2},
        ],
        "heart_rating": "ok", "heart_note": "Fine.", "confidence": 0.7,
    })

    class Messages:
        def create(self, **kw):
            calls.append(kw)
            return types.SimpleNamespace(
                stop_reason=stop_reason,
                content=[types.SimpleNamespace(type="thinking", thinking=""),
                         types.SimpleNamespace(type="text", text=reply)],
            )

    sdk = types.ModuleType("anthropic")
    sdk.Anthropic = lambda **kw: types.SimpleNamespace(messages=Messages())
    return sdk, calls


class AnalyzerTest(unittest.TestCase):
    def run_with(self, sdk):
        with mock.patch.dict(sys.modules, {"anthropic": sdk}), \
             mock.patch.object(analyzer, "ANTHROPIC_API_KEY", "k"):
            return analyzer.analyze(text="truita i pa amb tomàquet")

    def test_structured_request_and_totals(self):
        sdk, calls = fake_sdk()
        data = self.run_with(sdk)
        kw = calls[0]
        self.assertGreaterEqual(kw["max_tokens"], 16000)          # room for thinking + JSON
        self.assertEqual(kw["output_config"]["format"]["type"], "json_schema")
        self.assertEqual(data["total_kcal"], 430)
        self.assertEqual(data["total_saturated_fat_g"], 3.8)
        self.assertEqual(len(data["items"]), 2)

    def test_cut_off_reply_is_a_failure_not_zeros(self):
        sdk, _ = fake_sdk(stop_reason="max_tokens")
        with self.assertLogs(analyzer.log, "WARNING"):
            self.assertIsNone(self.run_with(sdk))


if __name__ == "__main__":
    unittest.main()
