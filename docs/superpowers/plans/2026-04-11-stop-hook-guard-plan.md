# Stop Hook Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repo-local native Claude `Stop` hook that blocks invalid waiting-style stops, allows clearly valid stops, and sends only gray-area cases through a Claude-backed classifier with safe fallback.

**Architecture:** Use a single `command` Stop hook registered in `.claude/settings.json`. The hook entry script reads the stop payload from stdin, performs deterministic first-pass classification, optionally calls a narrow Claude classifier for gray-area cases, and returns structured hook JSON. Keep prompt text in a single source, verify behavior with scripted payload tests, and avoid any design that depends on multiple Stop hooks running in sequence.

**Tech Stack:** Bash, Python 3, jq, Claude Code hooks, repo-local `.claude/settings.json`, Deno task runner only for scoped verification wrappers when useful

---

## File Structure

### Existing files to modify

- `.claude/settings.json`
  - Register the repo-local `Stop` command hook without changing existing PermissionRequest / PostToolUse hooks.
- `README.md`
  - Document the new stop guard behavior only if the final implementation changes repo-documented workflow expectations.

### New files to create

- `.claude/hooks/stop-guard.py`
  - Main Stop hook entrypoint. Parse stdin JSON, classify obvious allow/block, invoke Claude only for gray-area cases, and emit hook JSON.
- `.claude/hooks/stop-guard-prompt.txt`
  - Single source of truth for the gray-area classifier prompt used by `stop-guard.py`.
- `.claude/hooks/stop-guard-fixtures/waiting.json`
  - Sample Stop payload for invalid waiting-style stop.
- `.claude/hooks/stop-guard-fixtures/handback.json`
  - Sample Stop payload for obvious hand-back-next-step stop.
- `.claude/hooks/stop-guard-fixtures/blocker.json`
  - Sample Stop payload for real blocker.
- `.claude/hooks/stop-guard-fixtures/confirm.json`
  - Sample Stop payload for high-risk confirmation.
- `.claude/hooks/stop-guard-fixtures/decision.json`
  - Sample Stop payload for real branching decision.
- `.claude/hooks/stop-guard-fixtures/gray.json`
  - Sample Stop payload for gray-area model judgment.
- `.claude/hooks/stop-guard-fixtures/reentrant.json`
  - Sample Stop payload / env case for re-entrancy guard.
- `.claude/hooks/stop-guard_test.py`
  - Scripted regression tests for deterministic classification, fallback, and emitted hook JSON shape.

## Execution Notes

- Do not add a second Stop hook for prompt classification; same-event hooks run in parallel, not sequentially.
- Do not depend on `BLOCKED:` / `CONFIRM:` / `DECISION:` tags for correctness.
- Keep deterministic rules narrow and legible; prefer a few focused phrase groups over giant unreadable regex blobs.
- Keep Claude classifier output schema tiny: `ALLOW` or `BLOCK`, plus one short reason.
- If Claude classification fails, allow the stop and surface the raw stop reason to the user.
- Keep existing `.claude/settings.json` hooks intact.

---

### Task 1: Add deterministic stop classification tests first

**Files:**
- Create: `.claude/hooks/stop-guard_test.py`
- Create: `.claude/hooks/stop-guard-fixtures/waiting.json`
- Create: `.claude/hooks/stop-guard-fixtures/handback.json`
- Create: `.claude/hooks/stop-guard-fixtures/blocker.json`
- Create: `.claude/hooks/stop-guard-fixtures/confirm.json`
- Create: `.claude/hooks/stop-guard-fixtures/decision.json`
- Create: `.claude/hooks/stop-guard-fixtures/gray.json`
- Create: `.claude/hooks/stop-guard-fixtures/reentrant.json`
- Create: `.claude/hooks/stop-guard.py`

- [ ] **Step 1: Write waiting-style and hand-back fixture payloads**

```json
// .claude/hooks/stop-guard-fixtures/waiting.json
{
  "hook_event_name": "Stop",
  "reason": "我先停在这里，等你回复后我再继续。"
}
```

```json
// .claude/hooks/stop-guard-fixtures/handback.json
{
  "hook_event_name": "Stop",
  "reason": "如果你要，我可以继续整理剩余文档。"
}
```

- [ ] **Step 2: Write valid-stop and gray-area fixture payloads**

```json
// .claude/hooks/stop-guard-fixtures/blocker.json
{
  "hook_event_name": "Stop",
  "reason": "缺少访问凭据，当前无法继续请求上游服务。"
}
```

```json
// .claude/hooks/stop-guard-fixtures/confirm.json
{
  "hook_event_name": "Stop",
  "reason": "接下来会删除当前 worktree 和分支，这属于不可逆操作，需要你确认。"
}
```

```json
// .claude/hooks/stop-guard-fixtures/decision.json
{
  "hook_event_name": "Stop",
  "reason": "这里有两个互斥实现路径：只拦等待式 stop，或顺手扩成通用 stop 守门；需要你选范围。"
}
```

```json
// .claude/hooks/stop-guard-fixtures/gray.json
{
  "hook_event_name": "Stop",
  "reason": "我已经整理出下一步，但它是否需要你先拍板还不完全明确。"
}
```

```json
// .claude/hooks/stop-guard-fixtures/reentrant.json
{
  "hook_event_name": "Stop",
  "reason": "灰区判定执行中再次触发 stop 时不应重入模型调用。"
}
```

- [ ] **Step 3: Write failing Python regression tests for deterministic classification and fallback contract**

```python
# .claude/hooks/stop-guard_test.py
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "stop-guard.py"
FIXTURES = ROOT / "stop-guard-fixtures"


def run_fixture(name: str, *, extra_env: dict[str, str] | None = None) -> dict:
    payload = (FIXTURES / name).read_text()
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    proc = subprocess.run(
        [sys.executable, str(SCRIPT)],
        input=payload,
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout or "{}")


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


def test_gray_stop_allows_when_classifier_fails() -> None:
    result = run_fixture("gray.json", extra_env={"STOP_GUARD_FAKE_CLASSIFIER": "fail"})
    assert result.get("systemMessage")
    assert "模型判定失败" in result["systemMessage"]
    assert "原始 stop 信息" in result["systemMessage"]


def test_reentrant_guard_skips_classifier() -> None:
    result = run_fixture("gray.json", extra_env={"STOP_GUARD_ACTIVE": "1"})
    assert result.get("systemMessage")
    assert "跳过灰区模型判定" in result["systemMessage"]


def main() -> int:
    tests = [
        test_waiting_stop_is_blocked,
        test_handback_stop_is_blocked,
        test_blocker_stop_is_allowed,
        test_high_risk_confirm_is_allowed,
        test_decision_stop_is_allowed,
        test_gray_stop_allows_when_classifier_fails,
        test_reentrant_guard_skips_classifier,
    ]
    for test in tests:
        test()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests to verify they fail**

Run:

```bash
python3 .claude/hooks/stop-guard_test.py
```

Expected: FAIL because `.claude/hooks/stop-guard.py` does not exist yet or lacks the required classification behavior.

- [ ] **Step 5: Create minimal hook entrypoint that makes the tests importable but still fails behaviorally**

```python
# .claude/hooks/stop-guard.py
#!/usr/bin/env python3
import json
import sys


def main() -> int:
    _payload = json.load(sys.stdin)
    print("{}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 6: Run tests again to confirm behavioral failures, not missing-file failures**

Run:

```bash
python3 .claude/hooks/stop-guard_test.py
```

Expected: FAIL on waiting/hand-back assertions because the script always returns `{}`.

---

### Task 2: Implement deterministic classification and safe emitted JSON

**Files:**
- Modify: `.claude/hooks/stop-guard.py`
- Test: `.claude/hooks/stop-guard_test.py`

- [ ] **Step 1: Implement payload parsing and common JSON response helpers**

```python
# inside .claude/hooks/stop-guard.py
from __future__ import annotations

import json
import os
import re
import sys
from typing import Any


def load_payload() -> dict[str, Any]:
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}


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
```

- [ ] **Step 2: Implement obvious waiting-style / hand-back detection**

```python
WAITING_PATTERNS = [
    r"等你回复",
    r"等你确认",
    r"等你决定",
    r"wait for your reply",
    r"let me know",
    r"pause here",
    r"我先停在这里",
]

HANDBACK_PATTERNS = [
    r"如果你要.*我可以继续",
    r"if you want.*i can continue",
    r"我可以接着做",
    r"我可以继续整理",
]


def matches_any(text: str, patterns: list[str]) -> bool:
    lowered = text.lower()
    return any(re.search(pattern, lowered, re.IGNORECASE) for pattern in patterns)


def is_invalid_waiting_stop(reason: str) -> bool:
    return matches_any(reason, WAITING_PATTERNS)


def is_invalid_handback_stop(reason: str) -> bool:
    return matches_any(reason, HANDBACK_PATTERNS)
```

- [ ] **Step 3: Implement obvious valid-stop detection**

```python
BLOCKER_PATTERNS = [
    r"缺少.*权限",
    r"缺少.*凭据",
    r"无法继续",
    r"command not found",
    r"not found",
    r"token",
]

CONFIRM_PATTERNS = [
    r"删除.*worktree",
    r"删除.*分支",
    r"push",
    r"merge",
    r"cleanup",
    r"不可逆操作",
]

DECISION_PATTERNS = [
    r"两个互斥",
    r"需要你选",
    r"a/b",
    r"scope",
    r"方案分叉",
]


def is_valid_blocker(reason: str) -> bool:
    return matches_any(reason, BLOCKER_PATTERNS)


def is_valid_confirm(reason: str) -> bool:
    return matches_any(reason, CONFIRM_PATTERNS)


def is_valid_decision(reason: str) -> bool:
    return matches_any(reason, DECISION_PATTERNS)
```

- [ ] **Step 4: Wire deterministic allow/block behavior into main**

```python
# inside main()
payload = load_payload()
reason = str(payload.get("reason", "") or "")

if is_invalid_waiting_stop(reason):
    return emit(block("检测到错误等待式 stop：当前没有真实用户参与需求，应继续执行而不是等待。"))

if is_invalid_handback_stop(reason):
    return emit(block("检测到明显下一步回推：当前 stop 只是把仍可继续的工作交还给用户。"))

if is_valid_blocker(reason) or is_valid_confirm(reason) or is_valid_decision(reason):
    return emit(allow())

return emit(allow())
```

- [ ] **Step 5: Run regression tests and verify only gray-area / fallback cases remain failing**

Run:

```bash
python3 .claude/hooks/stop-guard_test.py
```

Expected: PASS for obvious waiting/blocker/confirm/decision tests, FAIL for gray-area classifier / re-entrancy tests.

---

### Task 3: Add gray-area Claude classification with safe fallback and re-entrancy guard

**Files:**
- Modify: `.claude/hooks/stop-guard.py`
- Create: `.claude/hooks/stop-guard-prompt.txt`
- Test: `.claude/hooks/stop-guard_test.py`

- [ ] **Step 1: Write the classifier prompt as a standalone single-source file**

```text
# .claude/hooks/stop-guard-prompt.txt
你是 Claude Code Stop hook 的灰区分类器。

任务：判断这次 stop 是否真的需要用户参与。

只允许输出以下两种格式之一：
ALLOW	<20字内原因>
BLOCK	<20字内原因>

允许（ALLOW）条件：
- 继续执行会越权或需要高风险确认
- 存在真实阻塞
- 存在真实方案分叉，下一步取决于用户业务选择

阻止（BLOCK）条件：
- 只是礼貌性停顿
- 只是“等你回复/确认”
- 只是把明显下一步回推给用户
- 实现 / review / 回修 / 验证仍可继续
```

- [ ] **Step 2: Add prompt loading, transcript truncation, and re-entrancy guard**

```python
PROMPT_PATH = os.path.join(os.path.dirname(__file__), "stop-guard-prompt.txt")
MAX_TRANSCRIPT_CHARS = 4000


def load_prompt() -> str:
    with open(PROMPT_PATH, "r", encoding="utf-8") as f:
        return f.read()


def load_transcript_excerpt(path: str | None) -> str:
    if not path or not os.path.exists(path):
        return ""
    with open(path, "r", encoding="utf-8") as f:
        data = f.read()
    return data[-MAX_TRANSCRIPT_CHARS:]


def stop_guard_active() -> bool:
    return os.environ.get("STOP_GUARD_ACTIVE") == "1"
```

- [ ] **Step 3: Add Claude classifier subprocess wrapper with test seam**

```python
import subprocess


def classify_gray_area(reason: str, transcript_excerpt: str) -> tuple[str, str]:
    fake = os.environ.get("STOP_GUARD_FAKE_CLASSIFIER")
    if fake == "allow":
        return "ALLOW", "测试放行"
    if fake == "block":
        return "BLOCK", "测试阻止"
    if fake == "fail":
        raise RuntimeError("classifier failed")

    prompt = load_prompt()
    full_prompt = (
        f"{prompt}\n\n"
        f"[STOP REASON]\n{reason}\n\n"
        f"[TRANSCRIPT EXCERPT]\n{transcript_excerpt}\n"
    )

    proc = subprocess.run(
        [
            "claude",
            "-p",
            "--output-format",
            "text",
            "--permission-mode",
            "bypassPermissions",
            full_prompt,
        ],
        text=True,
        capture_output=True,
        check=False,
        env={**os.environ, "STOP_GUARD_ACTIVE": "1"},
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "classifier command failed")

    line = (proc.stdout or "").strip().splitlines()[0]
    if "\t" not in line:
        raise RuntimeError(f"invalid classifier output: {line}")
    decision, short_reason = line.split("\t", 1)
    return decision.strip().upper(), short_reason.strip()
```

- [ ] **Step 4: Add gray-area decision path and failure fallback**

```python
# at end of main(), replacing final bare allow()
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
```

- [ ] **Step 5: Update tests to exercise gray allow/block and failure fallback**

```python

def test_gray_stop_blocks_when_classifier_says_block() -> None:
    result = run_fixture("gray.json", extra_env={"STOP_GUARD_FAKE_CLASSIFIER": "block"})
    assert result["decision"] == "block"
    assert "灰区 stop 被判定为无效" in result["reason"]


def test_gray_stop_allows_when_classifier_says_allow() -> None:
    result = run_fixture("gray.json", extra_env={"STOP_GUARD_FAKE_CLASSIFIER": "allow"})
    assert result == {}
```

- [ ] **Step 6: Run regression tests and verify all hook-script tests pass**

Run:

```bash
python3 .claude/hooks/stop-guard_test.py
```

Expected: PASS for all scripted classification cases.

---

### Task 4: Register the Stop hook in settings and prove it parses correctly

**Files:**
- Modify: `.claude/settings.json`
- Test: `.claude/hooks/stop-guard_test.py`

- [ ] **Step 1: Read the existing settings and preserve existing hooks**

Existing structure to preserve:

```json
{
  "hooks": {
    "PermissionRequest": [ ... ],
    "PostToolUse": [ ... ]
  }
}
```

- [ ] **Step 2: Add a single Stop command hook entry without disturbing existing arrays**

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "Bash|Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/permission-request-allow.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/fmt-after-write.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 .claude/hooks/stop-guard.py",
            "timeout": 20,
            "statusMessage": "Evaluating stop guard"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Validate the settings JSON shape and Stop hook extraction**

Run:

```bash
jq -e '.hooks.Stop[] | .hooks[] | select(.type == "command") | .command' .claude/settings.json
```

Expected output:

```text
"python3 .claude/hooks/stop-guard.py"
```

- [ ] **Step 4: Pipe-test the hook entrypoint with a blocked waiting payload**

Run:

```bash
cat .claude/hooks/stop-guard-fixtures/waiting.json | python3 .claude/hooks/stop-guard.py
```

Expected output contains:

```json
{"decision":"block"
```

- [ ] **Step 5: Pipe-test the hook entrypoint with a gray payload and classifier failure fallback**

Run:

```bash
STOP_GUARD_FAKE_CLASSIFIER=fail cat .claude/hooks/stop-guard-fixtures/gray.json | python3 .claude/hooks/stop-guard.py
```

Expected output contains both:

```text
模型判定失败
原始 stop 信息：
```

---

### Task 5: Run scoped verification, review docs impact, and prepare handoff

**Files:**
- Modify if needed: `README.md`
- Test: `.claude/hooks/stop-guard_test.py`
- Verify: `.claude/settings.json`

- [ ] **Step 1: Run the scripted hook regression tests**

Run:

```bash
python3 .claude/hooks/stop-guard_test.py
```

Expected: PASS

- [ ] **Step 2: Run scoped formatting and Python syntax checks for touched hook files**

Run:

```bash
deno task fmt:check .claude/settings.json README.md
```

Expected: PASS if README changed; if README was untouched, run:

```bash
deno task fmt:check .claude/settings.json
```

Then run:

```bash
python3 -m py_compile .claude/hooks/stop-guard.py .claude/hooks/stop-guard_test.py
```

Expected: PASS with no syntax errors in the Python hook files.

- [ ] **Step 3: Re-run the full repo test baseline because settings / hook workflow changed and this branch already established a clean full baseline**

Run:

```bash
deno task test
```

Expected:

```text
passed
```

with 0 failures.

- [ ] **Step 4: Decide whether README needs an update**

If implementation changed user-visible repo workflow expectations, add a short section like:

```md
## Claude Stop Guard

仓库在 `.claude/settings.json` 注册了一个原生 `Stop` hook，用来拦截明显无效的等待式 stop。灰区会走 Claude 判定；若判定失败，会把原始 stop 信息透传给用户继续判断。
```

If README does not currently document repo-local Claude workflow customizations, explicitly leave it unchanged and note that choice in the final report.

- [ ] **Step 5: Prepare review handoff summary**

Final report must state:

```text
- 改了什么：新增 stop-guard hook、灰区 Claude 判定、settings 注册
- 验证：脚本回归测试、pipe-test、fmt/lint/check/test 结果
- 未运行：真实 interactive Stop 场景仍未做端到端人工演练（若确实未做）
- 风险：灰区语义仍可能误判，关键词 allow/block 词表可能需要后续微调
```

---

## Self-Review Checklist

- Spec coverage: tasks cover native hook replacement, deterministic block/allow, gray-area Claude judgment, failure fallback, settings registration, and verification.
- Placeholder scan: no TBD/TODO placeholders remain; each code-changing step includes concrete code or command.
- Type consistency: the design consistently uses a single `command` Stop hook and a Python entry script at `.claude/hooks/stop-guard.py`; no later task assumes a separate prompt hook pipeline.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-11-stop-hook-guard-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
