// Export and import helpers for the side panel. The worker produces and
// validates the payload; this module only turns it into a downloadable file
// and reads a chosen file back. No network, no storage access.
(() => {
  "use strict";

  const NS = globalThis.ReadTrailSidePanel = globalThis.ReadTrailSidePanel || {};

  function fileNameFor(date) {
    const d = date instanceof Date ? date : new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `readtrail-export-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  }

  // Triggers a download of the payload from an extension page. Extension
  // pages may download blobs without the downloads permission.
  function downloadPayload(payload, doc) {
    const document_ = doc || document;
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document_.createElement("a");
    link.href = url;
    link.download = fileNameFor(new Date(payload && payload.exportedAt ? payload.exportedAt : Date.now()));
    link.rel = "noopener";
    document_.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch (_) { /* already revoked */ }
    }, 1000);
    return link.download;
  }

  // Reads a File chosen by the reader and parses it. Resolves with the parsed
  // payload or rejects with a short error code.
  function readPayloadFile(file, maxBytes) {
    return new Promise((resolve, reject) => {
      if (!file || typeof file.size !== "number") {
        reject(new Error("no-file"));
        return;
      }
      if (maxBytes && file.size > maxBytes) {
        reject(new Error("too-large"));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read-failed"));
      reader.onload = () => {
        try {
          resolve(JSON.parse(String(reader.result)));
        } catch (_) {
          reject(new Error("invalid-json"));
        }
      };
      reader.readAsText(file);
    });
  }

  NS.exportImport = Object.freeze({ fileNameFor, downloadPayload, readPayloadFile });
})();
