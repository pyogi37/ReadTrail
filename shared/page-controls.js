// Pure state machine for the "current page" controls shared by the popup and
// the side panel. No DOM, no Chrome APIs: callers render the returned
// descriptor. Loaded as a classic script after shared/constants.js.
(() => {
  "use strict";

  const RESTORE_QUALITIES = ["exact", "approximate", "fallback"];

  function hasPosition(state) {
    return Boolean(state && state.position && typeof state.position === "object");
  }

  function positionTime(position) {
    return position && typeof position.savedAt === "number" && Number.isFinite(position.savedAt)
      ? position.savedAt
      : null;
  }

  // Decides which save action the current page offers.
  //   none    the page is not active: no save action at all
  //   save    no durable record exists yet
  //   saved   the durable record is at least as new as the temporary position
  //   update  the temporary position is newer than the durable record
  // `justSaved` forces "saved" right after a successful save so the reader
  // sees a confirmation even before the state is re-read.
  function saveButtonState(pageState, savedRecord, flags) {
    const justSaved = Boolean(flags && flags.justSaved);
    if (!pageState || pageState.active !== true) {
      return { kind: "none", label: "Save for later", hint: "", disabled: true };
    }
    if (justSaved) {
      return {
        kind: "saved",
        label: "Saved",
        hint: "Your place on this page is saved on this device.",
        disabled: false
      };
    }
    if (!savedRecord) {
      return {
        kind: "save",
        label: "Save for later",
        hint: "Save exactly where you stopped, then continue later.",
        disabled: false
      };
    }
    const current = hasPosition(pageState) ? positionTime(pageState.position) : null;
    const durable = positionTime(savedRecord.position);
    if (current !== null && durable !== null && current <= durable) {
      return {
        kind: "saved",
        label: "Saved",
        hint: "Your saved place matches where you are now.",
        disabled: true
      };
    }
    return {
      kind: "update",
      label: "Update saved position",
      hint: "A place is already saved for this page. Update it to your current spot.",
      disabled: false
    };
  }

  // Human copy for how the last restoration went. Empty when exact or unknown.
  function restoreNote(pageState) {
    const quality = pageState && pageState.restoreQuality;
    if (!RESTORE_QUALITIES.includes(quality) || quality === "exact") return "";
    if (quality === "approximate") {
      return "Restored approximately. This page has changed since you saved your place.";
    }
    return "Restored by scroll position. The saved line could not be found on this page.";
  }

  const shared = globalThis.ReadTrailShared || {};
  shared.pageControls = Object.freeze({
    saveButtonState,
    restoreNote,
    RESTORE_QUALITIES: Object.freeze([...RESTORE_QUALITIES])
  });
  globalThis.ReadTrailShared = shared;
})();
