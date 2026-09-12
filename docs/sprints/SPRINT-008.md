# Sprint 008: BYO-Key AI (Phase 6, ships 1.1.0)

## Status

Planned. Starts after 1.0.0 is approved in the store.

## Goal

Readers who add their own Anthropic API key can ask for a summary of saved passages, tag suggestions, and connection suggestions. Nothing runs without a key and a click.

## Scope

- Options: key field, model select (`claude-sonnet-5` default, `claude-haiku-4-5`), Test key, Remove key, plaintext-storage warning.
- `background/ai.js` (loaded with `importScripts`): the only network code. `POST https://api.anthropic.com/v1/messages` with `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`. `output_config: {effort: "low"}` only for Sonnet (rejected on Haiku). Structured JSON via `output_config.format` for tags and connections, parsed defensively. Handle `stop_reason` `refusal` and `max_tokens`; map 401, 429, 5xx to copy; 60-second abort; one retry on 429 honoring `retry-after`. Test key via `GET /v1/models`.
- Worker handlers: `aiSetKey`, `aiRemoveKey`, `aiTestKey`, `aiSummarize`, `aiSuggestTags`, `aiSuggestConnections`.
- `readtrail.ai.v1 = {version:1, apiKey, model, updatedAt}` in `storage.local`; never synced; never touched by clear-all.
- Inputs are built only from stored passages, notes, and titles. Never live page content.
- Results are proposals (Apply, Keep as note, Discard). Kept notes carry `source:"ai"`. Token usage shown.
- `PRIVACY.md` and store data-usage disclosure updated.

## Acceptance criteria

1. No `fetch` is issued unless a key exists and a user-triggered AI message arrives.
2. Request bodies contain stored text only; a sentinel placed in a live page never appears.
3. `effort` is absent for Haiku requests.
4. Errors map to actionable copy; nothing is persisted unless the reader keeps a result.
5. The key never leaves `storage.local`.

## Files

`options/*`, `background/ai.js`, `background/service-worker.js`, `sidepanel/ai-view.js`, `tests/ai.test.js`, `PRIVACY.md`, `docs/store/LISTING.md`, `CHANGELOG.md`.
