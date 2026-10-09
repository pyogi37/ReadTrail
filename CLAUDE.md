@AGENTS.md

## Claude Code specifics

- Run `/code-review` and `/ponytail-review` on the diff before each commit; run `/simplify` after a phase is green.
- Codebase searches: the graphify rules below first, then Explore subagents; do not read whole directories into context. Run `/graphify . --update` after a sprint lands so docs join the graph.
- Ponytail is this project's default mode (level: full). Its rules are imported below and never remove validation, incognito handling, or accessibility. Setup: `docs/AI-WORKFLOW.md`.

@docs/PONYTAIL.md
- End commit messages with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` when Claude authored the change.
- Preferred model per task: see `docs/AI-WORKFLOW.md`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
