# workflow

## Included skills

- `workflow-start` — ensure the current Claude session is in the right worktree.
- `workflow-finish` — finalize changes, merge back, and clean up the worktree.
- `workflow-execute-plan` — enter a worktree, then delegate to `superpowers:executing-plans`.

## Shared implementation

- `worktree.ts` — the only place that defines workflow order, git checks, and structured errors.
