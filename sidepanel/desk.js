// Desk composes the existing page-first library and draft editor. Hash routes
// are deliberately small and readable: they are browser history, not another
// source of state.
(() => {
  "use strict";

  const NS = globalThis.ReadTrailSidePanel = globalThis.ReadTrailSidePanel || {};
  const KEYS = (globalThis.ReadTrailShared && globalThis.ReadTrailShared.KEYS) || {};
  const knowledgeView = NS.knowledgeView;
  const draftView = NS.draftView;
  let els = null;
  let applyingRoute = false;

  function hashForKnowledge(state) {
    if (state.query) return `#/search?q=${encodeURIComponent(state.query)}`;
    if (state.view === "tags") return state.tag ? `#/topics/${encodeURIComponent(state.tag)}` : "#/topics";
    return "#/sources";
  }

  function setHash(hash, replace = false) {
    if (window.location.hash === hash) return;
    if (replace) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
      return;
    }
    window.location.hash = hash;
  }

  function showPane(name, focus = false) {
    const pane = name === "draft" ? "draft" : "sources";
    els.shell.dataset.activePane = pane;
    for (const [button, value] of [[els.sourcesTab, "sources"], [els.draftTab, "draft"]]) {
      const active = value === pane;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    if (focus) (pane === "draft" ? els.draftTab : els.sourcesTab).focus();
  }

  function parseRoute() {
    const hash = window.location.hash || "#/sources";
    const draft = hash.match(/^#\/drafts\/([^/?#]+)$/);
    if (draft) return { kind: "draft", id: decodeURIComponent(draft[1]) };
    const topic = hash.match(/^#\/topics(?:\/([^?#]+))?$/);
    if (topic) return { kind: "topic", tag: topic[1] ? decodeURIComponent(topic[1]) : "" };
    if (hash.startsWith("#/search")) {
      const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
      return { kind: "search", query: new URLSearchParams(query).get("q") || "" };
    }
    if (hash === "#/drafts") return { kind: "draft-index" };
    return { kind: "sources" };
  }

  function applyRoute() {
    if (!knowledgeView || !draftView) return;
    applyingRoute = true;
    const route = parseRoute();
    if (route.kind === "draft") {
      draftView.openDraft(route.id, { silent: true });
      showPane("draft");
    } else if (route.kind === "draft-index") {
      draftView.closeDraft({ silent: true });
      showPane("draft");
    } else if (route.kind === "topic") {
      knowledgeView.navigate({ view: "tags", tag: route.tag, query: "" }, { silent: true });
      showPane("sources");
    } else if (route.kind === "search") {
      knowledgeView.navigate({ view: "pages", tag: "", query: route.query }, { silent: true });
      showPane("sources");
    } else {
      knowledgeView.navigate({ view: "pages", tag: "", query: "" }, { silent: true });
      showPane("sources");
    }
    applyingRoute = false;
  }

  function wirePaneSwitcher() {
    els.sourcesTab.addEventListener("click", () => showPane("sources"));
    els.draftTab.addEventListener("click", () => showPane("draft"));
    for (const button of [els.sourcesTab, els.draftTab]) {
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        showPane(els.shell.dataset.activePane === "sources" ? "draft" : "sources", true);
      });
    }
  }

  function init() {
    const $ = (id) => document.getElementById(id);
    els = {
      shell: $("deskMain"),
      sourcesTab: $("sourcesTab"),
      draftTab: $("draftTab")
    };
    if (!els.shell || !knowledgeView || !draftView) return;

    wirePaneSwitcher();
    knowledgeView.setQuoteHandler((passage, done) => {
      draftView.quoteInto(passage.id, (ok) => {
        // On a narrow Desk the draft also contains any "open a draft first"
        // guidance, so always reveal it after a quote attempt.
        showPane("draft");
        done(ok);
      });
    });
    knowledgeView.setNavigationHandler((state) => {
      if (!applyingRoute) setHash(hashForKnowledge(state), Boolean(state.query));
    });
    draftView.setNavigationHandler((id) => {
      if (!applyingRoute) setHash(id ? `#/drafts/${encodeURIComponent(id)}` : "#/drafts");
      showPane("draft");
    });

    knowledgeView.init();
    draftView.init(applyRoute);
    window.addEventListener("hashchange", applyRoute);
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local" || !changes) return;
        const keys = Object.keys(changes);
        const sourcePrefixes = [KEYS.SAVED_PREFIX, KEYS.PASSAGE_PREFIX, KEYS.NOTE_PREFIX, KEYS.PAGEMETA_PREFIX]
          .filter(Boolean);
        if (keys.some((key) => sourcePrefixes.some((prefix) => key.startsWith(prefix)))) {
          knowledgeView.scheduleReload();
        }
        // Sources refreshed themselves and drafts never did, so a second Desk
        // tab held a stale list for its whole life. Since a save ships the
        // whole document, the stale tab's autosave would win.
        if (KEYS.DRAFT_PREFIX && keys.some((key) => key.startsWith(KEYS.DRAFT_PREFIX))) {
          draftView.scheduleReload();
        }
      });
    }
  }

  NS.desk = { init, applyRoute, showPane };
  init();
})();
