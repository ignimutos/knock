# 测试架构迁移报告模板

## Metrics

- R01-R20 coverage: <covered>/20
- Layered pass rate: unit=<rate> contract=<rate> flow=<rate>
- Scoped test latency: P50=<value> P90=<value>

## Verification Commands

- [ ] deno task test <scoped...>
- [ ] deno task check <scoped...>
- [ ] deno task lint:check <scoped...>
- [ ] deno task fmt:check <scoped...>
- [ ] deno task test (full; boundary hit)
- [ ] python -m unittest discover -s .claude/skills/test-architecture-guard/scripts -p "test_guard.py"
- [ ] python .claude/skills/test-architecture-guard/scripts/guard.py --check-risk-files

## Scope

- 迁移范围：<paths>
- 原子提交：<commit list>

## Remaining Risks

- <risk or none>

## Notes

- <implementation note>
