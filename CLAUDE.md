@AGENTS.md

## Claude Code specifics

- Run `/code-review` on the diff before each commit; run `/simplify` after a phase is green.
- Use Explore subagents for codebase searches; do not read whole directories into context.
- End commit messages with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` when Claude authored the change.
- Preferred model per task: see `docs/AI-WORKFLOW.md`.
