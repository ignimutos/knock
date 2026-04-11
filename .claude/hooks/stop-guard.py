#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

WAITING_PATTERNS = [
    r"等你回复",
    r"等你确认",
    r"等你决定",
    r"wait for your reply",
    r"let me know",
    r"pause here",
]

HANDBACK_PATTERNS = [
    r"如果你要.*我可以继续",
    r"if you want.*i can continue",
    r"我可以接着做",
    r"我可以继续整理",
]

BLOCKER_PATTERNS = [
    r"缺少.*权限",
    r"缺少.*凭据",
    r"缺少.*token",
    r"当前无法继续",
    r"无法继续(请求|执行|访问|运行|调用)",
    r"command not found",
    r"命令不存在",
]

CONFIRM_PATTERNS = [
    r"删除.*worktree",
    r"删除.*分支",
    r"force push",
    r"reset --hard",
    r"merge 到 (main|master)",
    r"合并到(主分支|main|master)",
    r"cleanup 当前(worktree|分支)",
    r"清理当前(worktree|分支)",
    r"不可逆操作",
]

DECISION_PATTERNS = [
    r"两个互斥(实现路径|方案|选项)?",
    r"需要你选(范围|方案|路径)",
    r"需要你在.*二选一",
    r"方案分叉",
]

HOOK_DIR = Path(__file__).resolve().parent
REPO_ROOT = HOOK_DIR.parent.parent
PROMPT_PATH = HOOK_DIR / "stop-guard-prompt.txt"
MAX_TRANSCRIPT_CHARS = 4000
CLASSIFIER_TIMEOUT_SECONDS = 10


class PayloadParseError(Exception):
    pass


class ClassifierParseError(Exception):
    pass



def load_payload() -> dict[str, Any]:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        raise PayloadParseError("Stop guard 解析输入失败，当前 stop 交由用户继续判断。") from exc

    if not isinstance(payload, dict):
        raise PayloadParseError("Stop guard 解析输入失败，当前 stop 交由用户继续判断。")

    return payload


def emit(payload: dict[str, Any]) -> int:
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def block(message: str) -> dict[str, Any]:
    return {
        "decision": "block",
        "reason": message,
        "systemMessage": message,
    }


def allow() -> dict[str, Any]:
    return {}


def matches_any(text: str, patterns: list[str]) -> bool:
    lowered = text.lower()
    return any(re.search(pattern, lowered, re.IGNORECASE) for pattern in patterns)


def is_invalid_waiting_stop(reason: str) -> bool:
    return matches_any(reason, WAITING_PATTERNS)


def is_invalid_handback_stop(reason: str) -> bool:
    return matches_any(reason, HANDBACK_PATTERNS)


def is_valid_blocker(reason: str) -> bool:
    return matches_any(reason, BLOCKER_PATTERNS)


def is_valid_confirm(reason: str) -> bool:
    return matches_any(reason, CONFIRM_PATTERNS)


def is_valid_decision(reason: str) -> bool:
    return matches_any(reason, DECISION_PATTERNS)


def load_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def resolve_optional_path(path: str | None) -> Path | None:
    if not path:
        return None

    candidate = Path(path)
    if candidate.is_absolute():
        return candidate

    return REPO_ROOT / candidate


def load_transcript_excerpt(path: str | None) -> str:
    resolved = resolve_optional_path(path)
    if resolved is None or not resolved.exists() or not resolved.is_file():
        return ""

    return resolved.read_text(encoding="utf-8", errors="replace")[-MAX_TRANSCRIPT_CHARS:]


def stop_guard_active() -> bool:
    return os.environ.get("STOP_GUARD_ACTIVE") == "1"


def parse_classifier_output(output: str) -> tuple[str, str]:
    line = next((line.strip() for line in output.splitlines() if line.strip()), "")
    match = re.match(r"^(ALLOW|BLOCK)(?:\s+(.+))?$", line, re.IGNORECASE)
    if match is None:
        raise ClassifierParseError(f"invalid classifier output: {line}")

    decision = match.group(1).upper()
    short_reason = (match.group(2) or "未提供原因").strip()
    return decision, short_reason


def build_classifier_prompt(reason: str, transcript_excerpt: str) -> str:
    prompt = load_prompt().rstrip()
    excerpt = transcript_excerpt or "(empty)"
    return (
        f"{prompt}\n\n"
        f"[STOP REASON]\n{reason}\n\n"
        f"[TRANSCRIPT EXCERPT]\n{excerpt}\n"
    )


def classify_gray_area(reason: str, transcript_excerpt: str) -> tuple[str, str]:
    fake = os.environ.get("STOP_GUARD_FAKE_CLASSIFIER")
    if fake == "allow":
        return "ALLOW", "测试放行"
    if fake == "block":
        return "BLOCK", "测试阻止"
    if fake == "fail":
        raise RuntimeError("classifier failed")
    if fake == "timeout":
        raise subprocess.TimeoutExpired(cmd=["claude"], timeout=CLASSIFIER_TIMEOUT_SECONDS)
    if fake == "malformed":
        return parse_classifier_output("maybe")
    if fake == "nonzero":
        raise RuntimeError("classifier command failed")

    proc = subprocess.run(
        [
            os.environ.get("STOP_GUARD_CLAUDE_BIN", "claude"),
            "-p",
            "--output-format",
            "text",
            "--permission-mode",
            "bypassPermissions",
            build_classifier_prompt(reason, transcript_excerpt),
        ],
        text=True,
        capture_output=True,
        check=False,
        cwd=str(REPO_ROOT),
        env={**os.environ, "STOP_GUARD_ACTIVE": "1"},
        timeout=CLASSIFIER_TIMEOUT_SECONDS,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "classifier command failed")

    return parse_classifier_output(proc.stdout or "")


def main() -> int:
    try:
        payload = load_payload()
    except PayloadParseError as exc:
        return emit({"systemMessage": str(exc)})

    reason = str(payload.get("reason", "") or "")

    if is_valid_blocker(reason) or is_valid_confirm(reason) or is_valid_decision(reason):
        return emit(allow())

    if is_invalid_waiting_stop(reason):
        return emit(block("检测到错误等待式 stop：当前没有真实用户参与需求，不应等用户回复，应继续执行。"))

    if is_invalid_handback_stop(reason):
        return emit(block("检测到明显下一步回推：当前 stop 只是把仍可继续的工作交还给用户。"))

    if stop_guard_active():
        return emit({
            "systemMessage": "Stop guard 已处于活动状态，跳过灰区模型判定；当前 stop 交由用户继续判断。",
        })

    transcript_excerpt = load_transcript_excerpt(payload.get("transcript_path"))

    try:
        decision, short_reason = classify_gray_area(reason, transcript_excerpt)
    except Exception:
        return emit({
            "systemMessage": (
                "Stop guard 模型判定失败，已改为人工判断。\n\n"
                f"原始 stop 信息：{reason}"
            )
        })

    if decision == "BLOCK":
        return emit(block(f"灰区 stop 被判定为无效：{short_reason}"))

    return emit(allow())


if __name__ == "__main__":
    raise SystemExit(main())
