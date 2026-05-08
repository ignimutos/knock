import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from guard import (
    _default_legacy_assertion_check,
    _default_risk_mapping_check,
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

    def test_legacy_assertion_detector_blocks_historical_titles(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            test_path = temp_root / "src" / "config" / "legacy_config_test.ts"
            test_path.parent.mkdir(parents=True, exist_ok=True)
            test_path.write_text(
                """
import { test } from '../../testing/test_api.ts'

test('[contract] validateConfig: 旧 delivery.http 应拒绝并指向新路径', () => {})
                """.strip()
                + "\n",
                encoding="utf-8",
            )

            with patch("guard._repo_root", return_value=temp_root):
                result = _default_legacy_assertion_check(["src/config/legacy_config_test.ts"])

            self.assertEqual(result, {"ok": False, "missing": ["src/config/legacy_config_test.ts"]})

    def test_legacy_assertion_detector_allows_current_fact_titles(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            test_path = temp_root / "src" / "config" / "load_config_test.ts"
            test_path.parent.mkdir(parents=True, exist_ok=True)
            test_path.write_text(
                """
import { test } from '../../testing/test_api.ts'

test('loadConfig: 应支持 config.yaml fallback', () => {})
                """.strip()
                + "\n",
                encoding="utf-8",
            )

            with patch("guard._repo_root", return_value=temp_root):
                result = _default_legacy_assertion_check(["src/config/load_config_test.ts"])

            self.assertEqual(result, {"ok": True, "missing": []})

    def test_legacy_assertion_detector_ignores_non_adjacent_legacy_comments(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            test_path = temp_root / "src" / "config" / "comment_context_test.ts"
            test_path.parent.mkdir(parents=True, exist_ok=True)
            test_path.write_text(
                """
import { test } from '../../testing/test_api.ts'

// deprecated transport note for docs only
const helper = true

test('loadConfig: 应支持 config.yaml fallback', () => {
  void helper
})
                """.strip()
                + "\n",
                encoding="utf-8",
            )

            with patch("guard._repo_root", return_value=temp_root):
                result = _default_legacy_assertion_check(["src/config/comment_context_test.ts"])

            self.assertEqual(result, {"ok": True, "missing": []})

    def test_stdin_path_extraction_supports_tool_input_and_tool_response(self) -> None:
        repo_root = Path(__file__).resolve().parents[4]
        stdin_payload = (
            f'{{"tool_input":{{"file_path":"{repo_root.as_posix()}/src/core/logger_test.ts"}},'
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

    def test_risk_mapping_check_allows_unit_layer_tests_without_risk_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            docs_dir = temp_root / "docs" / "testing"
            docs_dir.mkdir(parents=True, exist_ok=True)
            (docs_dir / "risk-matrix.yml").write_text(
                """
- id: R01
  owner_tests:
    - src/existing_test.ts
                """.strip()
                + "\n",
                encoding="utf-8",
            )

            test_path = temp_root / "src" / "testing" / "runtime_harness_test.ts"
            test_path.parent.mkdir(parents=True, exist_ok=True)
            test_path.write_text(
                """
import { test } from './test_api.ts'

// layer: unit

test('runtime-harness: 显式 runtimeDir 调用应先清空目录并最终 cleanup', () => {})
                """.strip()
                + "\n",
                encoding="utf-8",
            )

            with patch("guard._repo_root", return_value=temp_root):
                result = _default_risk_mapping_check(["src/testing/runtime_harness_test.ts"])

            self.assertEqual(result, {"ok": True, "missing": []})

    def test_validate_owner_test_paths_supports_variable_length_risk_id_and_tsx_owner_test(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            docs_dir = temp_root / "docs" / "testing"
            docs_dir.mkdir(parents=True, exist_ok=True)

            matrix_path = docs_dir / "risk-matrix.yml"
            matrix_path.write_text(
                """
- id: R123
  owner_tests:
    - src/sources/web/create_web_request_handler_test.tsx
                """.strip()
                + "\n",
                encoding="utf-8",
            )

            with patch("guard._repo_root", return_value=temp_root):
                missing = validate_owner_test_paths(matrix_path)

            self.assertEqual(missing, ["src/sources/web/create_web_request_handler_test.tsx"])

    def test_risk_mapping_check_treats_tsx_test_file_as_test_surface(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            docs_dir = temp_root / "docs" / "testing"
            docs_dir.mkdir(parents=True, exist_ok=True)
            (docs_dir / "risk-matrix.yml").write_text(
                """
- id: R01
  owner_tests:
    - src/existing_test.ts
                """.strip()
                + "\n",
                encoding="utf-8",
            )

            test_path = temp_root / "src" / "sources" / "web" / "create_web_request_handler_test.tsx"
            test_path.parent.mkdir(parents=True, exist_ok=True)
            test_path.write_text(
                """
import { test } from '../../../testing/test_api.ts'

test('web request handler: renders response', () => {})
                """.strip()
                + "\n",
                encoding="utf-8",
            )

            with patch("guard._repo_root", return_value=temp_root):
                result = _default_risk_mapping_check(["src/sources/web/create_web_request_handler_test.tsx"])

            self.assertEqual(
                result,
                {"ok": False, "missing": ["src/sources/web/create_web_request_handler_test.tsx"]},
            )

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
            "package.json",
            "bun.lock",
            "scripts/run-paths.sh",
            "src/main.ts",
            "src/container_entrypoint.ts",
            "src/test_runtime.ts",
            "src/sources/xquery.ts",
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
                self.assertIn("bun run test", executed)

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
        self.assertIn("bun run test:path -- src/core/logger_test.ts", executed)
        self.assertIn("bun run check", executed)
        self.assertIn("bun run fmt:check:path -- src/core/logger_test.ts docs/testing/risk-matrix.yml", executed)


if __name__ == "__main__":
    unittest.main()
