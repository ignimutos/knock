import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from guard import (
    _merge_changed_paths,
    _parse_hook_json_stdin,
    run_guard,
    validate_owner_test_paths,
)


class GuardTests(unittest.TestCase):
    def test_missing_risk_mapping_blocks_gate(self) -> None:
        result = run_guard(
            changed_paths=["src/core/logger_test.ts"],
            check_risk_mapping=lambda _: {"ok": False, "missing": ["src/core/logger_test.ts"]},
            check_shared_entrypoint=lambda _: {"ok": True, "missing": []},
            command_runner=lambda _: (0, ""),
        )

        self.assertEqual(result["gate"], "blocked")
        self.assertIn("risk_mapping", result["failed_checks"])

    def test_shared_component_violation_blocks_gate(self) -> None:
        result = run_guard(
            changed_paths=["src/core/logger_test.ts"],
            check_risk_mapping=lambda _: {"ok": True, "missing": []},
            check_shared_entrypoint=lambda _: {"ok": False, "missing": ["src/core/logger_test.ts"]},
            command_runner=lambda _: (0, ""),
        )

        self.assertEqual(result["gate"], "blocked")
        self.assertIn("shared_test_components", result["failed_checks"])

    def test_report_structure_contains_required_keys(self) -> None:
        result = run_guard(
            changed_paths=["src/core/logger_test.ts"],
            check_risk_mapping=lambda _: {"ok": True, "missing": []},
            check_shared_entrypoint=lambda _: {"ok": True, "missing": []},
            command_runner=lambda _: (0, ""),
        )

        self.assertIn("gate", result)
        self.assertIn("failed_checks", result)
        self.assertIn("actionable_fix", result)
        self.assertIn("related_paths", result)

    def test_stdin_path_extraction_supports_tool_input_and_tool_response(self) -> None:
        stdin_payload = (
            '{"tool_input":{"file_path":"/root/git/knock/.claude/worktrees/testing-refactor/src/core/logger_test.ts"},'
            '"tool_response":{"filePath":"src/db/client_test.ts"}}'
        )

        extracted = _parse_hook_json_stdin(stdin_payload)
        merged = _merge_changed_paths([], extracted)

        self.assertIn("src/core/logger_test.ts", merged)
        self.assertIn("src/db/client_test.ts", merged)

    def test_check_risk_files_detects_missing_owner_tests(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            docs_dir = temp_root / "docs" / "testing"
            docs_dir.mkdir(parents=True, exist_ok=True)

            matrix_path = docs_dir / "risk-matrix.yml"
            matrix_path.write_text(
                """
- id: R01
  owner_tests:
    - src/existing_test.ts

- id: R02
  owner_tests:
    - src/missing_test.ts
                """.strip()
                + "\n",
                encoding="utf-8",
            )

            (temp_root / "src").mkdir(parents=True, exist_ok=True)
            (temp_root / "src" / "existing_test.ts").write_text("ok\n", encoding="utf-8")

            with patch("guard._repo_root", return_value=temp_root):
                missing = validate_owner_test_paths(matrix_path)

            self.assertEqual(missing, ["src/missing_test.ts"])

    def test_empty_changed_paths_blocks_gate_without_risk_file_check(self) -> None:
        result = run_guard(
            changed_paths=[],
            check_risk_mapping=lambda _: {"ok": True, "missing": []},
            check_shared_entrypoint=lambda _: {"ok": True, "missing": []},
            command_runner=lambda _: (0, ""),
            check_risk_files=False,
        )

        self.assertEqual(result["gate"], "blocked")
        self.assertIn("changed_paths_missing", result["failed_checks"])
        self.assertTrue(
            any("--changed" in message and "stdin" in message for message in result["actionable_fix"]),
        )

    def test_new_high_risk_boundaries_trigger_full_test_command(self) -> None:
        for boundary_path in (
            "scripts/run-paths.sh",
            "src/test_runtime.ts",
            "src/sources/source_runtime.ts",
        ):
            with self.subTest(boundary_path=boundary_path):
                executed = []

                def runner(command):
                    executed.append(" ".join(command))
                    return (0, "")

                result = run_guard(
                    changed_paths=[boundary_path],
                    check_risk_mapping=lambda _: {"ok": True, "missing": []},
                    check_shared_entrypoint=lambda _: {"ok": True, "missing": []},
                    command_runner=runner,
                )

                self.assertEqual(result["gate"], "passed")
                self.assertIn("deno task test", executed)

    def test_scoped_check_skips_non_code_paths(self) -> None:
        executed = []

        def runner(command):
            executed.append(" ".join(command))
            return (0, "")

        result = run_guard(
            changed_paths=["src/core/logger_test.ts", "docs/testing/risk-matrix.yml"],
            check_risk_mapping=lambda _: {"ok": True, "missing": []},
            check_shared_entrypoint=lambda _: {"ok": True, "missing": []},
            command_runner=runner,
        )

        self.assertEqual(result["gate"], "passed")
        self.assertIn("deno task test src/core/logger_test.ts", executed)
        self.assertIn("deno task check src/core/logger_test.ts", executed)
        self.assertTrue(all("docs/testing/risk-matrix.yml" not in cmd or "fmt:check" in cmd for cmd in executed))


if __name__ == "__main__":
    unittest.main()
