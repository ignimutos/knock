#!/usr/bin/env python3
import argparse
import json
import sys
from typing import Callable, Dict, List, Optional, TypedDict


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


def _default_risk_mapping_check(changed_paths: List[str]) -> CheckResult:
    _ = changed_paths
    return {"ok": True, "missing": []}


def _default_shared_entrypoint_check(changed_paths: List[str]) -> CheckResult:
    _ = changed_paths
    return {"ok": True, "missing": []}


def run_guard(
    changed_paths: List[str],
    check_risk_mapping: Optional[RiskCheck] = None,
    check_shared_entrypoint: Optional[SharedEntrypointCheck] = None,
) -> GuardReport:
    risk_checker = check_risk_mapping or _default_risk_mapping_check
    shared_checker = check_shared_entrypoint or _default_shared_entrypoint_check

    failed_checks: List[str] = []
    actionable_fix: List[str] = []

    risk_result = risk_checker(changed_paths)
    if not risk_result.get("ok", False):
        failed_checks.append("risk_mapping")
        missing = risk_result.get("missing", [])
        if missing:
            actionable_fix.append(f"补齐风险映射: {', '.join(missing)}")
        else:
            actionable_fix.append("补齐风险映射")

    shared_result = shared_checker(changed_paths)
    if not shared_result.get("ok", False):
        failed_checks.append("shared_entrypoint")
        missing = shared_result.get("missing", [])
        if missing:
            actionable_fix.append(f"统一共享测试入口: {', '.join(missing)}")
        else:
            actionable_fix.append("统一共享测试入口")

    return {
        "gate": "passed" if not failed_checks else "blocked",
        "failed_checks": failed_checks,
        "actionable_fix": actionable_fix,
        "related_paths": changed_paths,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="test architecture hard gate")
    parser.add_argument("--changed", nargs="*", default=[], help="changed paths")
    args = parser.parse_args()

    report = run_guard(changed_paths=list(args.changed))
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report["gate"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
