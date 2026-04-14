#!/usr/bin/env python3
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Callable, Dict, List, Optional, Set, Tuple, TypedDict


class CheckResult(TypedDict):
    ok: bool
    missing: List[str]


class GuardReport(TypedDict):
    gate: str
    failed_checks: List[str]
    actionable_fix: List[str]
    related_paths: List[str]


RiskCheck = Callable[[List[str]], CheckResult]
SharedEntrypointCheck = Callable[[List[str]], CheckResult]
CommandRunner = Callable[[List[str]], Tuple[int, str]]


RISK_ID_PATTERN = re.compile(r"\bR\d{2}\b")
SHARED_RUNTIME_PATTERN = re.compile(
    r"\bprepareOwnedRuntime\b|\bcleanupOwnedRuntime\b|\bDeno\.makeTempDir(?:Sync)?\b",
)

HIGH_RISK_BOUNDARIES = (
    "deno.json",
    "scripts/run-paths.sh",
    "src/main.ts",
    "src/core/app.ts",
    "src/db/client.ts",
    "src/db/schema.ts",
    "src/db/migrations/",
    "src/test_runtime.ts",
    "src/sources/xquery.ts",
    "src/sources/source_runtime.ts",
)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _risk_matrix_path() -> Path:
    return _repo_root() / "docs" / "testing" / "risk-matrix.yml"


def _is_test_file(path: str) -> bool:
    normalized = path.replace("\\", "/")
    return normalized.endswith("_test.ts")


def _normalize_changed_path(path: str) -> Optional[str]:
    if not path:
        return None

    raw = path.strip()
    if not raw:
        return None

    root = _repo_root().resolve()
    candidate = Path(raw)

    if candidate.is_absolute():
        try:
            relative = candidate.resolve().relative_to(root)
            normalized = str(relative)
        except ValueError:
            normalized = candidate.as_posix()
    else:
        normalized = raw

    normalized = normalized.replace("\\", "/")
    if normalized.startswith("./"):
        normalized = normalized[2:]

    return normalized or None


def _parse_hook_json_stdin(stdin_text: str) -> List[str]:
    raw = stdin_text.strip()
    if not raw:
        return []

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return []

    paths: List[str] = []

    def walk(node: object) -> None:
        if isinstance(node, dict):
            tool_input = node.get("tool_input")
            if isinstance(tool_input, dict):
                file_path = tool_input.get("file_path")
                if isinstance(file_path, str):
                    paths.append(file_path)

            tool_response = node.get("tool_response")
            if isinstance(tool_response, dict):
                file_path = tool_response.get("filePath")
                if isinstance(file_path, str):
                    paths.append(file_path)

            for value in node.values():
                walk(value)
            return

        if isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    return paths


def _collect_stdin_changed_paths() -> List[str]:
    if sys.stdin.isatty():
        return []

    stdin_text = sys.stdin.read()
    return _parse_hook_json_stdin(stdin_text)


def _merge_changed_paths(cli_changed: List[str], stdin_changed: List[str]) -> List[str]:
    merged: List[str] = []
    seen: Set[str] = set()

    for path in [*cli_changed, *stdin_changed]:
        normalized = _normalize_changed_path(path)
        if not normalized:
            continue
        if normalized in seen:
            continue
        seen.add(normalized)
        merged.append(normalized)

    return merged


def _load_owner_tests_from_risk_matrix(matrix_path: Path) -> Dict[str, List[str]]:
    owners_by_risk: Dict[str, List[str]] = {}
    current_risk_id: Optional[str] = None
    in_owner_tests = False

    for raw_line in matrix_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.rstrip()

        risk_match = re.match(r"^\s*-\s*id:\s*(R\d{2})\s*$", line)
        if risk_match:
            current_risk_id = risk_match.group(1)
            owners_by_risk.setdefault(current_risk_id, [])
            in_owner_tests = False
            continue

        if re.match(r"^\s*owner_tests:\s*$", line):
            in_owner_tests = True
            continue

        if in_owner_tests:
            owner_match = re.match(r"^\s*-\s*(.+?)\s*$", line)
            if owner_match and current_risk_id:
                owner_path = owner_match.group(1).strip().strip("\"'")
                if owner_path:
                    owners_by_risk[current_risk_id].append(owner_path)
                continue

            if line.strip() and not line.lstrip().startswith("-"):
                in_owner_tests = False

    return owners_by_risk


def validate_owner_test_paths(matrix_path: Optional[Path] = None) -> List[str]:
    path = matrix_path or _risk_matrix_path()
    root = _repo_root()
    owners = _load_owner_tests_from_risk_matrix(path)

    missing: List[str] = []
    for owner_tests in owners.values():
        for relative_path in owner_tests:
            if not (root / relative_path).exists():
                missing.append(relative_path)

    return sorted(set(missing))


def _default_risk_mapping_check(changed_paths: List[str]) -> CheckResult:
    test_files = [path for path in changed_paths if _is_test_file(path)]
    if not test_files:
        return {"ok": True, "missing": []}

    matrix_path = _risk_matrix_path()
    owners = _load_owner_tests_from_risk_matrix(matrix_path)
    owner_set = {path for owner_paths in owners.values() for path in owner_paths}

    missing: List[str] = []
    root = _repo_root()

    for path in test_files:
        full_path = root / path
        if not full_path.exists():
            continue

        content = full_path.read_text(encoding="utf-8")
        has_risk_marker = bool(RISK_ID_PATTERN.search(content))
        covered_by_owner = path in owner_set

        if not has_risk_marker and not covered_by_owner:
            missing.append(path)

    return {"ok": len(missing) == 0, "missing": missing}


def _default_shared_entrypoint_check(changed_paths: List[str]) -> CheckResult:
    test_files = [path for path in changed_paths if _is_test_file(path)]
    if not test_files:
        return {"ok": True, "missing": []}

    missing: List[str] = []
    root = _repo_root()

    for path in test_files:
        full_path = root / path
        if not full_path.exists():
            continue

        content = full_path.read_text(encoding="utf-8")
        if SHARED_RUNTIME_PATTERN.search(content):
            missing.append(path)

    return {"ok": len(missing) == 0, "missing": missing}


def _hits_high_risk_boundary(changed_paths: List[str]) -> bool:
    normalized_paths = [path.replace("\\", "/") for path in changed_paths]

    for path in normalized_paths:
        for boundary in HIGH_RISK_BOUNDARIES:
            if boundary.endswith("/"):
                if path.startswith(boundary):
                    return True
                continue

            if path == boundary:
                return True

    return False


def _is_checkable_path(path: str) -> bool:
    normalized = path.replace("\\", "/")
    return normalized.endswith((".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"))


def _verification_commands(changed_paths: List[str]) -> List[List[str]]:
    commands: List[List[str]] = []
    changed_test_files = [path for path in changed_paths if _is_test_file(path)]
    checkable_paths = [path for path in changed_paths if _is_checkable_path(path)]
    has_test_related_changes = bool(changed_test_files)
    has_high_risk_changes = _hits_high_risk_boundary(changed_paths)

    if not has_test_related_changes and not has_high_risk_changes:
        return commands

    if has_test_related_changes:
        commands.append(["deno", "task", "test", *changed_test_files])

    if checkable_paths:
        commands.append(["deno", "task", "check", *checkable_paths])

    if changed_paths:
        commands.append(["deno", "task", "fmt:check", *changed_paths])

    if has_high_risk_changes:
        commands.append(["deno", "task", "test"])

    return commands


def _run_command(command: List[str]) -> Tuple[int, str]:
    completed = subprocess.run(command, capture_output=True, text=True)
    output = (completed.stdout or "") + (completed.stderr or "")
    return completed.returncode, output.strip()


def _run_scoped_verification(
    changed_paths: List[str],
    command_runner: Optional[CommandRunner] = None,
) -> CheckResult:
    commands = _verification_commands(changed_paths)
    if not commands:
        return {"ok": True, "missing": []}

    runner = command_runner or _run_command
    failures: List[str] = []

    for command in commands:
        code, output = runner(command)
        if code == 0:
            continue

        command_text = " ".join(command)
        if output:
            failures.append(f"{command_text} -> {output.splitlines()[0]}")
        else:
            failures.append(command_text)

    return {"ok": len(failures) == 0, "missing": failures}


def run_guard(
    changed_paths: List[str],
    check_risk_mapping: Optional[RiskCheck] = None,
    check_shared_entrypoint: Optional[SharedEntrypointCheck] = None,
    command_runner: Optional[CommandRunner] = None,
    check_risk_files: bool = False,
) -> GuardReport:
    risk_checker = check_risk_mapping or _default_risk_mapping_check
    shared_checker = check_shared_entrypoint or _default_shared_entrypoint_check

    failed_checks: List[str] = []
    actionable_fix: List[str] = []

    if not changed_paths and not check_risk_files:
        failed_checks.append("changed_paths_missing")
        actionable_fix.append(
            "传入 --changed 路径，或通过 hook stdin 传入包含 file_path/filePath 的 payload",
        )

    risk_result = risk_checker(changed_paths)
    if not risk_result.get("ok", False):
        failed_checks.append("risk_mapping")
        missing = risk_result.get("missing", [])
        if missing:
            actionable_fix.append(f"补齐风险映射标记或 owner_tests: {', '.join(missing)}")
        else:
            actionable_fix.append("补齐风险映射")

    shared_result = shared_checker(changed_paths)
    if not shared_result.get("ok", False):
        failed_checks.append("shared_test_components")
        missing = shared_result.get("missing", [])
        if missing:
            actionable_fix.append(f"改用共享测试组件并移除本地 runtime 搭建: {', '.join(missing)}")
        else:
            actionable_fix.append("改用共享测试组件")

    if check_risk_files:
        missing_owner_tests = validate_owner_test_paths()
        if missing_owner_tests:
            failed_checks.append("risk_owner_tests")
            actionable_fix.append(
                f"修复 docs/testing/risk-matrix.yml 中不存在的 owner_tests 路径: {', '.join(missing_owner_tests)}",
            )

    verification_result = _run_scoped_verification(changed_paths, command_runner=command_runner)
    if not verification_result.get("ok", False):
        failed_checks.append("scoped_verification")
        failed_commands = verification_result.get("missing", [])
        actionable_fix.append(
            "修复验证命令失败: " + "; ".join(failed_commands),
        )

    return {
        "gate": "passed" if not failed_checks else "blocked",
        "failed_checks": failed_checks,
        "actionable_fix": actionable_fix,
        "related_paths": changed_paths,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="test architecture hard gate")
    parser.add_argument("--changed", nargs="*", default=[], help="changed paths")
    parser.add_argument(
        "--check-risk-files",
        action="store_true",
        help="validate owner_tests paths from docs/testing/risk-matrix.yml",
    )
    args = parser.parse_args()

    stdin_changed = _collect_stdin_changed_paths()
    changed_paths = _merge_changed_paths(list(args.changed), stdin_changed)

    report = run_guard(
        changed_paths=changed_paths,
        check_risk_files=args.check_risk_files,
    )
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report["gate"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
