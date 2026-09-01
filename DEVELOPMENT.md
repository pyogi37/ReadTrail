# ReadTrail Development Workflow

ReadTrail uses a small, review-led agent workflow. The goal is not maximum agent activity; it is a clear chain from product decision to tested increment.

## Roles

- **Product owner:** chooses outcomes, resolves product questions, and approves changes to vision.
- **Codex:** converts approved outcomes into sprint scope, defines interfaces, delegates bounded work, reviews every diff, integrates changes, and verifies the result.
- **OpenCode:** implements or tests one bounded task at a time using the configured free-tier worker. It does not own product or architecture decisions.

## Delivery loop

1. Select one user outcome from the product vision.
2. Write a sprint goal, non-goals, acceptance criteria, and technical boundaries.
3. Commit the product and sprint baseline.
4. Delegate tasks that have non-overlapping file ownership.
5. Review agent output before building on it.
6. Run automated checks and manually verify browser behavior where DOM layout or extension APIs matter.
7. Commit only a coherent, passing increment.
8. End the sprint with what was learned, not only what was shipped.

## Definition of done

A sprint increment is done when:

- Its acceptance criteria are demonstrably met.
- Existing and new automated tests pass.
- JavaScript and manifest files parse successfully.
- The diff contains no accidental files or secrets.
- Privacy and accessibility constraints have been reviewed.
- Browser-only behavior has a manual verification record.
- Documentation describes actual behavior and does not overclaim.
- Codex has reviewed the complete integrated diff.

## Commands

```sh
npm install
npm test
git diff --check
```

Chrome extension behavior must also be checked by loading the unpacked extension from this repository.

For an already loaded unpacked copy, click **Reload** on the ReadTrail card in `chrome://extensions`, then refresh each test page so its content scripts update. Reinstall only if the extension was removed or the project directory moved.

## OpenCode worker

The project worker is defined in `.opencode/agents/readtrail-worker.md` and uses the OpenCode Zen free-tier `opencode/big-pickle` model. Invoke it with a task that names its allowed files and acceptance criteria. Do not use `--auto`; the agent profile already defines its boundary.
