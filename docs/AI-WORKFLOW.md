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

## Design skills for the side panel (Phase 3)

- **impeccable** (`pbakaus/impeccable`): a design-language skill for Claude Code, Codex, and Gemini with `/craft`, `/audit`, `/polish`, `/normalize` passes and a 58-rule anti-pattern detector. Use `/audit` then `/polish` on `sidepanel/` and `options/` once they exist, and `/normalize` to keep spacing, radii, and type sizes consistent. Install per its README (owner action; third-party code is not pulled in by agents).
- **Motion**: the Framer Motion skills found online target React. ReadTrail is plain JS, so motion stays CSS-only: 150 to 250 ms ease-out transitions for state changes, no layout-shifting animation, everything behind `prefers-reduced-motion`. The `frontend-design-review` Codex skill already covers motion review; no extra skill is needed.

## Ponytail and graphify (owner-installed, 2026-10-09)

Two third-party skills the owner chose. Agents never pull third-party code in; the owner installs, agents use.

| Skill | Source | What it is for here |
|---|---|---|
| **Ponytail** | `DietrichGebert/ponytail` (MIT; Claude Code plugin with two lifecycle hooks, needs `node`) | Always-on "write only what the task needs" ladder: does it need to exist, is it already in the codebase, does the platform do it, only then the minimum plus one small test. This is ReadTrail's no-dependency rule made operational. `/ponytail-review` runs beside `/code-review` before each commit; `/ponytail-audit` once per sprint on the whole repo; `/ponytail-debt` collects deferred `shortcut:` comments into a ledger before a release. |
| **graphify** | `Graphify-Labs/graphify` (MIT; Python 3.10+, CLI `graphify`, PyPI name `graphifyy`) | A local knowledge graph of the repo and its docs. Replaces reading directories into context: `/graphify query "..."` and `/graphify path A B` before a Grep sweep; `/graphify . --update` after each sprint lands. Output lives in `graphify-out/`, which is git-ignored and rebuilt locally. The post-commit hook (`graphify hook install`) is an owner decision; it is not installed by agents. |

What is installed, project-scoped (done 2026-10-09 at the owner's request). `.claude/skills/` is git-ignored on purpose, so the skill files stay local and each machine installs them with the commands below; the rules, hooks and docs are committed.

- Ponytail's six skills under `.claude/skills/ponytail*`, installed with `npx -y skills add DietrichGebert/ponytail --agent claude-code`. Its compact ruleset is `docs/PONYTAIL.md`, imported by `CLAUDE.md`, so it is the default for every agent that reads a rules file. Default level is full. The optional plugin (`/plugin marketplace add DietrichGebert/ponytail`, then `/plugin install ponytail@ponytail`, two separate prompts in the Code tab) adds the two lifecycle hooks that print the current level; it is not required for the rules or the commands.
- graphify under `.claude/skills/graphify`, installed with `pipx install graphifyy` then `graphify install --project` (Python 3.14, pipx bin folder on the user PATH). It also wrote a `## graphify` section to `CLAUDE.md` and two `PreToolUse` hooks in `.claude/settings.json` that remind the agent to query the graph before grepping or reading source. The hooks add context only; they block nothing. The code graph is built with `graphify update .` (no model needed); `/graphify . --update` in a session adds the docs.

Not installed: graphify's post-commit hook and merge driver (owner decision), and the ponytail plugin's hooks.

Rules of use: Ponytail's ladder never cuts trust-boundary validation, incognito handling, accessibility, or the `prefers-reduced-motion` paths, which is also what AGENTS.md already requires. A `shortcut:` comment is a deferred decision and belongs in `docs/DECISIONS.md` if it changes behavior. graphify reads the repo only; it never runs against a reader's data or a page.

## Token rules

1. One phase per session. Start from `docs/STATUS.md` and `git log -3`, not the whole repo.
2. Name files and line ranges; never paste whole files into chat.
3. Run the touched test file first; the full suite only before commit.
4. Delegate discovery to search subagents; keep the lead's context for decisions and diffs.
5. Commit at every green checkpoint so a fresh session can resume from the log.
6. Codex review prompt: "Review `git diff main..HEAD` against the acceptance criteria in `docs/sprints/SPRINT-00N.md`. Report defects with file:line. Do not restate the diff."
7. OpenCode worker prompt: task id, allowed files, acceptance criteria, and "run `npm test -- <file>`". Nothing else.
8. Update `docs/STATUS.md` instead of re-explaining state in chat.
