// In-memory search over the library. Pure functions: build an inverted index
// from records, then query it with prefix matching. Nothing is persisted.
// Weights: title and tags 3, note 2, text 1. Results are ranked by weighted
// term frequency and tie-broken by recency.
(() => {
  "use strict";

  const NS = globalThis.ReadTrailSidePanel = globalThis.ReadTrailSidePanel || {};
  const TOKEN = /[\p{L}\p{N}]+/gu;
  const MIN_TOKEN = 2;

  function tokenize(text) {
    if (typeof text !== "string" || text.length === 0) return [];
    const out = [];
    for (const match of text.toLowerCase().matchAll(TOKEN)) {
      if (match[0].length >= MIN_TOKEN) out.push(match[0]);
    }
    return out;
  }

  function addTerms(postings, id, text, weight) {
    for (const token of tokenize(text)) {
      let entry = postings.get(token);
      if (!entry) {
        entry = new Map();
        postings.set(token, entry);
      }
      entry.set(id, (entry.get(id) || 0) + weight);
    }
  }

  // records: array of { id, kind, title, text, note?, tags, url, updatedAt }
  function buildIndex(records) {
    const postings = new Map();
    const byId = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      if (!record || typeof record.id !== "string") continue;
      byId.set(record.id, record);
      addTerms(postings, record.id, record.title, 3);
      addTerms(postings, record.id, Array.isArray(record.tags) ? record.tags.join(" ") : "", 3);
      addTerms(postings, record.id, record.note, 2);
      addTerms(postings, record.id, record.text, 1);
    }
    const tokens = [...postings.keys()].sort();
    return { tokens, postings, byId, size: byId.size };
  }

  // First index in the sorted token list whose entry is >= prefix.
  function lowerBound(tokens, prefix) {
    let low = 0;
    let high = tokens.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (tokens[mid] < prefix) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function search(index, query, limit) {
    const max = Number.isInteger(limit) && limit > 0 ? limit : 50;
    if (!index || !index.tokens) return [];
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    let scores = null;
    for (const term of terms) {
      const termScores = new Map();
      const start = lowerBound(index.tokens, term);
      for (let i = start; i < index.tokens.length; i++) {
        const token = index.tokens[i];
        if (!token.startsWith(term)) break;
        // Exact matches outrank prefix matches for the same term.
        const boost = token === term ? 2 : 1;
        for (const [id, weight] of index.postings.get(token)) {
          termScores.set(id, (termScores.get(id) || 0) + weight * boost);
        }
      }
      // Every term must match (AND semantics).
      if (scores === null) {
        scores = termScores;
      } else {
        for (const id of [...scores.keys()]) {
          if (!termScores.has(id)) scores.delete(id);
          else scores.set(id, scores.get(id) + termScores.get(id));
        }
      }
      if (scores.size === 0) return [];
    }
    return [...scores.entries()]
      .map(([id, score]) => ({ id, score, record: index.byId.get(id) }))
      .sort((a, b) => b.score - a.score || (b.record.updatedAt || 0) - (a.record.updatedAt || 0))
      .slice(0, max);
  }

  // Flattens a library reply into the records the index expects.
  function recordsFromLibrary(library) {
    const out = [];
    if (!library) return out;
    for (const saved of library.saved || []) {
      out.push({ id: "saved:" + saved.url, kind: "saved", title: saved.title, text: "", note: "", tags: [], url: saved.url, updatedAt: saved.savedAt });
    }
    for (const passage of library.passages || []) {
      out.push({ id: passage.id, kind: "passage", title: passage.title, text: passage.text, note: passage.note, tags: passage.tags, url: passage.url, updatedAt: passage.updatedAt });
    }
    for (const note of library.notes || []) {
      out.push({ id: note.id, kind: "note", title: note.title, text: note.text, note: "", tags: note.tags, url: note.url, updatedAt: note.updatedAt });
    }
    const metaByUrl = new Map((library.pagemeta || []).map((meta) => [meta.url, meta.tags]));
    for (const record of out) {
      const pageTags = metaByUrl.get(record.url);
      if (pageTags && pageTags.length) record.tags = [...new Set([...record.tags, ...pageTags])];
    }
    return out;
  }

  NS.searchIndex = Object.freeze({ tokenize, buildIndex, search, recordsFromLibrary });
})();
