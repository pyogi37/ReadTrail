# Sprint 009: Get the draft out (2.1, step 1)

## Status

Active. Started 2026-10-09. Direction: `docs/PRODUCT-DIRECTION-2.1.md` section 3.1.

## Goal

A reader can take a draft, or a single quote, out of the Desk as Markdown that reads correctly wherever they paste it, with every quote attributed and every source listed once. Nothing is read from any page and nothing new is stored.

## Scope

- `sidepanel/draft-markdown.js`: pure functions. `draftToMarkdown(draft)`, `quoteToMarkdown(block)`, `fileNameFor(title)`. No DOM, no storage, no Chrome APIs.
- Desk, open draft: **Copy as Markdown** and **Download .md** beside Close. Both act on the draft as it is on screen, including unsaved edits, because that is the document the reader is looking at.
- Desk, quote block options row: **Copy with source**, before Remove. Remove stays last (decision 70).
- `sidepanel/export-import.js`: generalise the blob download so a text file can be downloaded with a chosen name and type; the JSON export keeps its behaviour.
- Outcomes land in the draft status line: copied, downloaded with the file name, or why it did not happen. No new permission: extension pages may write the clipboard on a user gesture and download blobs without `downloads`.

## Markdown shape

```
# Draft title

Reader's text, exactly as written. A block that starts with "# " on the Desk
is a section under the draft, so it is written as "## " here.

> The quoted passage, each line of it prefixed.
>
> — Source title [1]

## Sources

1. Source title. https://example.com/page

Tags: one, two
```

- One number per source page, in order of first quotation; two quotes of one page share a number.
- Plain `[n]` references, not footnote syntax (decision 77).
- A source with no title is named by its host.
- Empty text blocks are skipped. Tags appear only if there are any.
- `quoteToMarkdown` is the blockquote alone with the title and URL on its attribution line, since it has no Sources list to point at.

## Acceptance criteria

1. `draftToMarkdown` on a draft with two quotes of one page and one of another yields exactly two Sources entries, numbered in order of first appearance, and each quote's reference matches its entry.
2. A `# ` text block becomes `## ` in the output; every other text block is byte-identical to what the reader wrote.
3. A multi-line quote has every line prefixed with `> `, including blank lines inside it.
4. Copy as Markdown writes `draftToMarkdown(current)` to the clipboard and the status line says so; when the clipboard is unavailable or refuses, the status line says so with `role="alert"` and suggests the download.
5. Download .md triggers a download named from the title (lower-case, hyphenated, at most 60 characters, `draft.md` when the title yields nothing) with the `text/markdown` type, and announces the file name.
6. A quote block's options row offers Copy with source before Remove; a text block's does not. The quote at rest still offers only its source, Return, and one options control (decision 69).
7. Nothing in this sprint sends a runtime message, reads a page, or writes storage.
8. `npm test`, `npm run test:e2e`, `npm run package:check`, `git diff --check` all green; `package:check` reports 32 files.

## Files

`sidepanel/draft-markdown.js` (new), `sidepanel/draft-view.js`, `sidepanel/desk.html`, `sidepanel/desk.css`, `sidepanel/export-import.js`, `tests/draft-markdown.test.js` (new), `tests/desk.test.js`, `docs/qa/MANUAL-QA.md`, `CHANGELOG.md`, `docs/DECISIONS.md`, `docs/STATUS.md`.

## Out of this sprint

Copy with source from the side panel's own clip list, HTML or rich-text clipboard flavours, front matter, exporting several drafts at once, importing Markdown. Steps 3.2 to 3.5 of the direction follow in their own sprints.
