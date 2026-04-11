import importlib.util
import json
import os
import subprocess
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "stop-guard.py"
FIXTURES = ROOT / "stop-guard-fixtures"


def load_stop_guard_module():
    spec = importlib.util.spec_from_file_location("stop_guard", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


STOP_GUARD = load_stop_guard_module()


def run_payload(payload: str, *, extra_env: dict[str, str] | None = None) -> dict:
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    proc = subprocess.run(
        [sys.executable, str(SCRIPT)],
        input=payload,
        text=True,
        encoding="utf-8",
        capture_output=True,
        env=env,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout, "stop-guard.py produced empty stdout"
    return json.loads(proc.stdout)


def run_fixture(name: str, *, extra_env: dict[str, str] | None = None) -> dict:
    return run_payload((FIXTURES / name).read_text(encoding="utf-8"), extra_env=extra_env)


def test_waiting_stop_is_blocked() -> None:
    result = run_fixture("waiting.json")
    assert result["decision"] == "block"
    assert "等用户回复" in result["reason"]


def test_handback_stop_is_blocked() -> None:
    result = run_fixture("handback.json")
    assert result["decision"] == "block"
    assert "回推" in result["reason"]


def test_blocker_stop_is_allowed() -> None:
    result = run_fixture("blocker.json")
    assert result == {}


def test_high_risk_confirm_is_allowed() -> None:
    result = run_fixture("confirm.json")
    assert result == {}


def test_decision_stop_is_allowed() -> None:
    result = run_fixture("decision.json")
    assert result == {}


def test_confirm_overlap_with_waiting_signal_is_allowed() -> None:
    result = run_payload(
        '{"hook_event_name":"Stop","reason":"接下来会删除当前 worktree 和分支，这属于不可逆操作，需要等你确认后才能执行。"}'
    )
    assert result == {}


def test_blocker_overlap_with_waiting_signal_is_allowed() -> None:
    result = run_payload(
        '{"hook_event_name":"Stop","reason":"缺少访问凭据，当前无法继续请求上游服务；即使要等你回复补齐凭据，这也是真实阻塞。"}'
    )
    assert result == {}


def test_summary_phrase_alone_is_not_waiting_stop() -> None:
    assert not STOP_GUARD.is_invalid_waiting_stop("我先停在这里，下面是当前进展总结。")


def test_allow_patterns_stay_intent_level() -> None:
    assert not STOP_GUARD.is_valid_blocker("日志里出现 not found 文案，但当前步骤未阻塞。")
    assert not STOP_GUARD.is_valid_blocker("这里讨论 token 刷新策略，不代表当前卡在认证问题上。")
    assert not STOP_GUARD.is_valid_confirm("我先 cleanup 一下说明文字。")
    assert not STOP_GUARD.is_valid_decision("这里不是 a/b 二选一，只是普通说明。")
    assert not STOP_GUARD.is_valid_decision("这一段在解释 stop guard 的 scope，不需要用户决定范围。")


def test_invalid_json_is_visible_parse_failure() -> None:
    result = run_payload("{not-json")
    assert result.get("systemMessage")
    assert "解析输入失败" in result["systemMessage"]
    assert "交由用户继续判断" in result["systemMessage"]


def test_gray_stop_blocks_when_classifier_says_block() -> None:
    result = run_fixture("gray.json", extra_env={"STOP_GUARD_FAKE_CLASSIFIER": "block"})
    assert result["decision"] == "block"
    assert "灰区 stop 被判定为无效" in result["reason"]


def test_gray_stop_allows_when_classifier_says_allow() -> None:
    result = run_fixture("gray.json", extra_env={"STOP_GUARD_FAKE_CLASSIFIER": "allow"})
    assert result == {}


def test_gray_stop_allows_when_classifier_fails() -> None:
    result = run_fixture("gray.json", extra_env={"STOP_GUARD_FAKE_CLASSIFIER": "fail"})
    assert result.get("systemMessage")
    assert "模型判定失败" in result["systemMessage"]
    assert "原始 stop 信息" in result["systemMessage"]


def test_gray_stop_allows_when_classifier_times_out() -> None:
    result = run_fixture("gray.json", extra_env={"STOP_GUARD_FAKE_CLASSIFIER": "timeout"})
    assert result.get("systemMessage")
    assert "模型判定失败" in result["systemMessage"]
    assert "原始 stop 信息" in result["systemMessage"]


def test_gray_stop_allows_when_classifier_output_is_malformed() -> None:
    result = run_fixture("gray.json", extra_env={"STOP_GUARD_FAKE_CLASSIFIER": "malformed"})
    assert result.get("systemMessage")
    assert "模型判定失败" in result["systemMessage"]
    assert "原始 stop 信息" in result["systemMessage"]


def test_gray_stop_allows_when_classifier_exits_nonzero() -> None:
    result = run_fixture("gray.json", extra_env={"STOP_GUARD_FAKE_CLASSIFIER": "nonzero"})
    assert result.get("systemMessage")
    assert "模型判定失败" in result["systemMessage"]
    assert "原始 stop 信息" in result["systemMessage"]


def test_reentrant_guard_skips_classifier() -> None:
    result = run_fixture("reentrant.json", extra_env={"STOP_GUARD_ACTIVE": "1"})
    assert result.get("systemMessage")
    assert "跳过灰区模型判定" in result["systemMessage"]


def main() -> int:
    tests = [
        test_waiting_stop_is_blocked,
        test_handback_stop_is_blocked,
        test_blocker_stop_is_allowed,
        test_high_risk_confirm_is_allowed,
        test_decision_stop_is_allowed,
        test_confirm_overlap_with_waiting_signal_is_allowed,
        test_blocker_overlap_with_waiting_signal_is_allowed,
        test_summary_phrase_alone_is_not_waiting_stop,
        test_allow_patterns_stay_intent_level,
        test_invalid_json_is_visible_parse_failure,
        test_gray_stop_blocks_when_classifier_says_block,
        test_gray_stop_allows_when_classifier_says_allow,
        test_gray_stop_allows_when_classifier_fails,
        test_gray_stop_allows_when_classifier_times_out,
        test_gray_stop_allows_when_classifier_output_is_malformed,
        test_gray_stop_allows_when_classifier_exits_nonzero,
        test_reentrant_guard_skips_classifier,
    ]
    failures: list[tuple[str, str]] = []

    for test in tests:
        try:
            test()
        except AssertionError:
            failures.append((test.__name__, traceback.format_exc()))
        except Exception:
            failures.append((test.__name__, traceback.format_exc()))

    if failures:
        for index, (name, details) in enumerate(failures, start=1):
            if index > 1:
                print()
            print(f"[{index}/{len(failures)}] {name} FAILED", file=sys.stderr)
            print(details.rstrip(), file=sys.stderr)
        print(file=sys.stderr)
        print(f"{len(failures)} test(s) failed", file=sys.stderr)
        return 1

    print(f"{len(tests)} test(s) passed", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
