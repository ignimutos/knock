# 测试架构迁移报告（2026-04-14）

## Metrics

- R01-R20 coverage: 20/20
- Layered pass rate: unit=100% contract=100% flow=100%
- Scoped test latency: P50=未单独采样 P90=未单独采样

## Verification Commands

- [x] deno task test src/config src/domain src/core
- [x] deno task check src/config src/domain src/core
- [x] deno task lint:check src/config src/domain src/core
- [x] deno task fmt:check src/config src/domain src/core
- [x] deno task test src/application src/sources src/deliveries src/infrastructure
- [x] deno task check src/application src/sources src/deliveries src/infrastructure
- [x] deno task lint:check src/application src/sources src/deliveries src/infrastructure
- [x] deno task fmt:check src/application src/sources src/deliveries src/infrastructure
- [x] deno task test src/interfaces src/main_test.ts src/web web
- [x] deno task check src/interfaces src/main.ts src/web web
- [x] deno task lint:check src/interfaces src/main_test.ts src/web web
- [x] deno task fmt:check src/interfaces src/main_test.ts src/web web docs/testing/risk-matrix.yml
- [x] python -m unittest discover -s .claude/skills/test-architecture-guard/scripts -p "test_guard.py"
- [x] python .claude/skills/test-architecture-guard/scripts/guard.py --check-risk-files
- [x] python .claude/skills/test-architecture-guard/scripts/guard.py --changed src/interfaces/config/load_definitions_test.ts src/interfaces/daemon/start_daemon_test.ts src/interfaces/web/preview_runtime_test.ts src/main_test.ts src/web/syndication_playground_test.ts src/web/xquery_playground_test.ts web/main_test.ts web/routes/api/syndication/evaluate_test.ts web/routes/api/xquery/evaluate_test.ts web/routes/index_test.ts web/routes/syndication_test.ts web/routes/xquery_test.ts docs/testing/risk-matrix.yml

## Scope

- 迁移范围：Task 1-6 已覆盖 risk matrix、shared testing components、guard、config/domain/core、application/sources/deliveries/infrastructure、interfaces/web/main
- 原子提交：
  - 2265107
  - d654505
  - c5fbc8c
  - a3dc9fd
  - 0392990
  - c7c87b4
  - 22a1618
  - 137c562
  - 94e3d9c
  - 2fc087e
  - 8f347cc
  - ee86780
  - 441f05f
  - 39c1bdd
  - fdc1772
  - 231550c

## Remaining Risks

- scoped latency 尚未建立自动采样脚本，当前报告仅记录命令通过性与覆盖状态

## Notes

- guard 已实现 fail-closed、high-risk boundary full-test trigger、stdin changed path 读取。
- guard 对 mixed changed paths（代码 + 文档）已支持 check 仅作用于 code paths，fmt:check 继续覆盖全路径。
