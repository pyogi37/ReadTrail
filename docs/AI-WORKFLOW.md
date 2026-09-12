# AI Workflow: models, roles, token rules

## Routing

| Work | Tool / model | Effort | Why |
|---|---|---|---|
| Architecture, the per-tab state redesign, pre-submit security review | Claude Code, Fable 5.1 | xhigh | Highest-stakes correctness; one-time cost |
| Day-to-day implementation, integration, commits | Claude Code, Opus 5 | high | Default lead; strong agentic coding at half the Fable price |
| Well-specified modules (search index, validators, package script, UI ports), test writing | Claude Code, Sonnet 5 subagents | medium | Much cheaper; sprint docs are precise enough |
| Boilerplate tests, CSS, doc formatting | OpenCode `big-pickle` (free) or Haiku 4.5 | low | Near-zero cost; lead reviews |
| Independent review of each phase diff; store-copy critique | Codex gpt-5.6-sol | high | Different model family, existing project context |
| Browser-driven manual QA | Codex (chrome / computer-use plugins); Claude in Chrome as backup | medium | Browser tooling already configured |
| Listing copy, privacy policy, microcopy | Claude Code, Sonnet 5 plus the `design:ux-copy` skill | medium | Writing task |
| In-product AI (1.1) | `claude-sonnet-5` default, `claude-haiku-4-5` option | low | Reader pays; short inputs |

## Skills per phase

| Phase | Claude Code | Codex (`~/.codex/skills`) |
|---|---|---|
| 1 and 2 | `code-review`, `simplify` | `vitest-skill`, `best-practices` |
| 3 | `design:design-critique`, `design:accessibility-review`, `design:ux-copy` | `frontend-design-review`, `accessibility` |
| 4 | `code-review`, `simplify` | `vitest-skill` |
| 5 | `security-review`, `design:ux-copy` | `web-quality-audit`, `webapp-testing` |
| 6 | `claude-api` | `best-practices` |

## Token rules

1. One phase per session. Start from `docs/STATUS.md` and `git log -3`, not the whole repo.
2. Name files and line ranges; never paste whole files into chat.
3. Run the touched test file first; the full suite only before commit.
4. Delegate discovery to search subagents; keep the lead's context for decisions and diffs.
5. Commit at every green checkpoint so a fresh session can resume from the log.
6. Codex review prompt: "Review `git diff main..HEAD` against the acceptance criteria in `docs/sprints/SPRINT-00N.md`. Report defects with file:line. Do not restate the diff."
7. OpenCode worker prompt: task id, allowed files, acceptance criteria, and "run `npm test -- <file>`". Nothing else.
8. Update `docs/STATUS.md` instead of re-explaining state in chat.
