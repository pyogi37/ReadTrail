// Connections between library items, computed at render time from the
// records already in memory. Three cheap relations: shared tags, same domain,
// and backlinks (an item's text or note contains another item's URL).
(() => {
  "use strict";

  const NS = globalThis.ReadTrailSidePanel = globalThis.ReadTrailSidePanel || {};

  function hostname(url) {
    try {
      return new URL(url).hostname;
    } catch (_) {
      return "";
    }
  }

  // records: output of searchIndex.recordsFromLibrary (id, kind, title, text,
  // note, tags, url, updatedAt). Returns { sameTag, sameDomain, backlinks }
  // for the record with the given id, each an array of { record, via }.
  function connectionsFor(records, id, limit) {
    const max = Number.isInteger(limit) && limit > 0 ? limit : 8;
    const list = Array.isArray(records) ? records : [];
    const self = list.find((record) => record && record.id === id);
    if (!self) return { sameTag: [], sameDomain: [], backlinks: [] };
    const selfTags = new Set(self.tags || []);
    const selfHost = hostname(self.url);
    const selfText = `${self.text || ""}\n${self.note || ""}`;

    const sameTag = [];
    const sameDomain = [];
    const backlinks = [];
    for (const other of list) {
      if (!other || other.id === id) continue;
      const shared = (other.tags || []).filter((tag) => selfTags.has(tag));
      if (shared.length > 0) sameTag.push({ record: other, via: shared });
      if (selfHost && hostname(other.url) === selfHost && other.url !== self.url) {
        sameDomain.push({ record: other, via: selfHost });
      }
      const otherText = `${other.text || ""}\n${other.note || ""}`;
      if (other.url !== self.url && (otherText.includes(self.url) || selfText.includes(other.url))) {
        backlinks.push({ record: other, via: "link" });
      }
    }
    const byRecency = (a, b) => (b.record.updatedAt || 0) - (a.record.updatedAt || 0);
    sameTag.sort((a, b) => b.via.length - a.via.length || byRecency(a, b));
    sameDomain.sort(byRecency);
    backlinks.sort(byRecency);
    return {
      sameTag: sameTag.slice(0, max),
      sameDomain: sameDomain.slice(0, max),
      backlinks: backlinks.slice(0, max)
    };
  }

  NS.connections = Object.freeze({ connectionsFor, hostname });
})();
