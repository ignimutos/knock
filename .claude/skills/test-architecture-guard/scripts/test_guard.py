import unittest

from guard import run_guard


class GuardTests(unittest.TestCase):
    def test_missing_risk_mapping_blocks_gate(self) -> None:
        result = run_guard(
            changed_paths=["src/core/logger_test.ts"],
            check_risk_mapping=lambda _: {"ok": False, "missing": ["R07"]},
            check_shared_entrypoint=lambda _: {"ok": True, "missing": []},
        )

        self.assertEqual(result["gate"], "blocked")
        self.assertIn("risk_mapping", result["failed_checks"])

    def test_report_structure_contains_required_keys(self) -> None:
        result = run_guard(
            changed_paths=["src/core/logger_test.ts"],
            check_risk_mapping=lambda _: {"ok": True, "missing": []},
            check_shared_entrypoint=lambda _: {"ok": True, "missing": []},
        )

        self.assertIn("gate", result)
        self.assertIn("failed_checks", result)
        self.assertIn("actionable_fix", result)
        self.assertIn("related_paths", result)


if __name__ == "__main__":
    unittest.main()
