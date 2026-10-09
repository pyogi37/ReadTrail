import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "sidepanel/draft-markdown.js"), "utf8");

let md;

beforeAll(() => {
  delete globalThis.ReadTrailSidePanel;
  window.eval(source);
  md = globalThis.ReadTrailSidePanel.draftMarkdown;
});

const quote = (overrides = {}) => ({
  type: "quote",
  passageId: "passage-1",
  text: "A useful piece of evidence.",
  url: "https://example.com/source",
  title: "Source page",
  ...overrides
});

const draft = (overrides = {}) => ({
  version: 1,
  id: "draft-1",
  title: "Working question",
  tags: [],
  blocks: [],
  createdAt: 100,
  updatedAt: 100,
  ...overrides
});

describe("draftToMarkdown", () => {
  it("numbers each source once, in order of first quotation, and points every quote at its entry", () => {
    const other = quote({ passageId: "passage-2", url: "https://other.org/paper", title: "Other paper", text: "Second source." });
    const again = quote({ passageId: "passage-3", text: "Same page, later paragraph." });
    const out = md.draftToMarkdown(draft({ blocks: [quote(), other, again] }));

    expect(out).toBe([
      "# Working question",
      "",
      "> A useful piece of evidence.",
      ">",
      "> — Source page [1]",
      "",
      "> Second source.",
      ">",
      "> — Other paper [2]",
      "",
      "> Same page, later paragraph.",
      ">",
      "> — Source page [1]",
      "",
      "## Sources",
      "",
      "1. Source page. https://example.com/source",
      "2. Other paper. https://other.org/paper",
      ""
    ].join("\n"));
  });

  it("passes the reader's text through byte for byte, except that a # section steps under the title", () => {
    const prose = "Keep *this* exactly.\n\n- even a list\n   with odd   spacing";
    const out = md.draftToMarkdown(draft({ blocks: [
      { type: "text", text: "# Findings" },
      { type: "text", text: prose },
      { type: "text", text: "## Already a subsection" }
    ] }));
    expect(out).toContain("\n\n## Findings\n\n");
    expect(out).toContain(`\n\n${prose}\n\n`);
    expect(out).toContain("\n\n## Already a subsection\n");
    expect(out).not.toContain("### Already");
  });

  it("prefixes every line of a multi-line quote, blank lines included", () => {
    const out = md.draftToMarkdown(draft({ blocks: [quote({ text: "First paragraph.\n\nSecond paragraph.\r\nThird, after a CRLF." })] }));
    expect(out).toContain("> First paragraph.\n>\n> Second paragraph.\n> Third, after a CRLF.\n>\n> — Source page [1]");
  });

  it("skips empty text blocks and omits the Sources list and Tags line when there is nothing to list", () => {
    const out = md.draftToMarkdown(draft({ blocks: [{ type: "text", text: "" }, { type: "text", text: "   \n" }, { type: "text", text: "One line." }] }));
    expect(out).toBe("# Working question\n\nOne line.\n");
  });

  it("names a source by its host when the page had no title, and lists tags last", () => {
    const out = md.draftToMarkdown(draft({
      tags: ["passkeys", "identity"],
      blocks: [quote({ title: "", url: "https://www.example.com/untitled" })]
    }));
    expect(out).toContain("> — www.example.com [1]");
    expect(out).toContain("1. www.example.com. https://www.example.com/untitled");
    expect(out.endsWith("\n\nTags: passkeys, identity\n")).toBe(true);
  });

  it("falls back to a heading when the title is blank", () => {
    expect(md.draftToMarkdown(draft({ title: "   " }))).toBe("# Untitled draft\n");
  });
});

describe("quoteToMarkdown", () => {
  it("carries the URL on its own attribution line, since it has no Sources list to point at", () => {
    expect(md.quoteToMarkdown(quote())).toBe(
      "> A useful piece of evidence.\n>\n> — Source page. https://example.com/source\n"
    );
  });
});

describe("fileNameFor", () => {
  it("makes a recognisable, safe file name from the title", () => {
    expect(md.fileNameFor("Do passkeys work across ecosystems?")).toBe("do-passkeys-work-across-ecosystems.md");
    expect(md.fileNameFor("  Résumé: notes / draft #2 ")).toBe("resume-notes-draft-2.md");
  });

  it("keeps letters of every script, so a title in Hindi or Chinese is still a name", () => {
    expect(md.fileNameFor("पासकी क्या हैं?")).toBe("पासकी-क्या-हैं.md");
    expect(md.fileNameFor("通行密钥 研究")).toBe("通行密钥-研究.md");
  });

  it("folds a title onto one line in the attribution and the Sources list", () => {
    const out = md.draftToMarkdown(draft({ blocks: [quote({ title: "Part one\n  Part two" })] }));
    expect(out).toContain("> — Part one Part two [1]");
    expect(out).toContain("1. Part one Part two. https://example.com/source");
  });

  it("falls back to draft.md and never exceeds sixty characters of slug", () => {
    expect(md.fileNameFor("")).toBe("draft.md");
    expect(md.fileNameFor("???")).toBe("draft.md");
    expect(md.fileNameFor(undefined)).toBe("draft.md");
    const long = md.fileNameFor("word ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long.endsWith("-.md")).toBe(false);
  });
});
