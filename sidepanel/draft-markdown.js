// A draft as Markdown: the one format every place a reader writes will take.
// Pure functions over the stored record. Nothing here reads a page, touches
// storage, or sends a message; the Desk decides where the text goes.
(() => {
  "use strict";

  const NS = globalThis.ReadTrailSidePanel = globalThis.ReadTrailSidePanel || {};

  // The one rule for naming a page by its host, shared with the Desk's own
  // citations so a quote and its export never name the same page differently.
  function hostOf(url) {
    try {
      return new URL(url).hostname || "";
    } catch (_) {
      return "";
    }
  }

  function normalizeLines(text) {
    return String(text == null ? "" : text).replace(/\r\n?/g, "\n");
  }

  // A source is named by its title, and by its host when the page had none.
  // The URL itself is the last resort, so a source is never nameless. The
  // title is folded onto one line: it ends a list item and an attribution
  // line, and an imported title may carry a newline that a page's never does.
  function sourceLabel(block) {
    const title = typeof block.title === "string" ? block.title.replace(/\s+/g, " ").trim() : "";
    return title || hostOf(block.url) || String(block.url || "");
  }

  // Every line of the passage carries the marker, blank lines included, so a
  // multi-paragraph quote stays one quotation instead of falling out of the
  // blockquote at its first empty line.
  function quoteLines(text) {
    return normalizeLines(text).split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
  }

  // One number per source page, in the order the draft first quotes it. Two
  // quotes of one page share a number, which is what a reader expects of a
  // reference list and what a tool that counts sources expects too.
  function numberSources(blocks) {
    const sources = [];
    const byUrl = new Map();
    for (const block of blocks) {
      if (block.type !== "quote" || byUrl.has(block.url)) continue;
      byUrl.set(block.url, sources.length + 1);
      sources.push({ url: block.url, label: sourceLabel(block) });
    }
    return { sources, byUrl };
  }

  // The reader's text passes through untouched, with one exception: the Desk
  // shows a block that starts with "# " as a section heading under the draft's
  // title, and the title is the document's "# " heading here, so the section
  // steps down one level to keep meaning the same thing.
  function textBlockMarkdown(text) {
    const value = normalizeLines(text);
    if (!value.trim()) return "";
    return value.startsWith("# ") ? `#${value}` : value;
  }

  function attribution(block, reference) {
    return `> — ${sourceLabel(block)}${reference}`;
  }

  function quoteBlockMarkdown(block, number) {
    return `${quoteLines(block.text)}\n>\n${attribution(block, number ? ` [${number}]` : "")}`;
  }

  function draftToMarkdown(draft) {
    const record = draft || {};
    const blocks = Array.isArray(record.blocks) ? record.blocks : [];
    const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : "Untitled draft";
    const { sources, byUrl } = numberSources(blocks);

    const parts = [`# ${title}`];
    for (const block of blocks) {
      const markdown = block.type === "quote"
        ? quoteBlockMarkdown(block, byUrl.get(block.url))
        : textBlockMarkdown(block.text);
      if (markdown) parts.push(markdown);
    }
    if (sources.length) {
      const list = sources.map((source, i) => `${i + 1}. ${source.label}. ${source.url}`).join("\n");
      parts.push(`## Sources\n\n${list}`);
    }
    if (Array.isArray(record.tags) && record.tags.length) {
      parts.push(`Tags: ${record.tags.join(", ")}`);
    }
    return `${parts.join("\n\n")}\n`;
  }

  // A quote on its own has no Sources list to point at, so its attribution
  // line carries the URL itself.
  function quoteToMarkdown(block) {
    return `${quoteLines(block.text)}\n>\n${attribution(block, `. ${block.url}`)}\n`;
  }

  // A file name a reader can recognise in a downloads folder: the title,
  // lower-cased and hyphenated. Letters and digits of every script are kept,
  // so a Hindi or Chinese title stays a name rather than collapsing to
  // "draft"; Latin accents are folded so "Résumé" becomes "resume".
  function fileNameFor(title) {
    const slug = String(title == null ? "" : title)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      // Marks stay: a Devanagari vowel sign is part of its letter, and the
      // Latin accents were already folded above.
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "");
    return `${slug || "draft"}.md`;
  }

  NS.draftMarkdown = Object.freeze({ draftToMarkdown, quoteToMarkdown, fileNameFor, hostOf });
})();
