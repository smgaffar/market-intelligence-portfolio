/* =========================================================================
   utils.js — pure helpers (no DOM, no data)
   ========================================================================= */
(function (global) {
  "use strict";

  /* ---- numeric safety ---- */
  const safeNum = (v, fb = 0) => (typeof v === "number" && isFinite(v) ? v : fb);
  const sum = (arr) => arr.reduce((a, b) => a + safeNum(b), 0);
  const avg = (arr) => (arr.length ? sum(arr) / arr.length : 0);
  const safeDiv = (a, b) => (b ? a / b : 0);
  const pctVal = (actual, target) => safeDiv(safeNum(actual), safeNum(target)); // fraction 0..1
  const round = (v, d = 0) => {
    const f = Math.pow(10, d);
    return Math.round(safeNum(v) * f) / f;
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, safeNum(v)));

  const stddev = (arr) => {
    if (!arr.length) return 0;
    const m = avg(arr);
    const v = avg(arr.map((x) => Math.pow(x - m, 2)));
    return Math.sqrt(v);
  };

  // percent change current vs previous; previous<=0 -> 0
  const pctChange = (cur, prev) => {
    cur = safeNum(cur); prev = safeNum(prev);
    if (prev <= 0) return 0;
    return (cur - prev) / prev;
  };

  /* ---- formatting ---- */
  const CR = 1e7;   // 1 Crore  = 10,000,000 BDT
  const LAC = 1e5;  // 1 Lakh   = 100,000 BDT

  const fmtNum = (v, d = 0) =>
    safeNum(v).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: 0 });

  // adaptive BDT formatter
  const fmtBDT = (v) => {
    v = safeNum(v);
    const abs = Math.abs(v);
    if (abs >= CR) return round(v / CR, 2) + " Cr";
    if (abs >= LAC) return round(v / LAC, 2) + " Lac";
    return fmtNum(v, 0) + " BDT";
  };
  const fmtCr = (v) => round(safeNum(v) / CR, 2) + " Cr";
  const fmtLac = (v) => round(safeNum(v) / LAC, 2) + " Lac";

  // fraction (0..1) -> "x.x%"
  const fmtPct = (frac, d = 1) => round(safeNum(frac) * 100, d) + "%";
  const fmtPctDelta = (frac, d = 1) => {
    const v = round(safeNum(frac) * 100, d);
    return (v > 0 ? "+" : "") + v + " pp";
  };
  const fmtSignedPct = (frac, d = 1) => {
    const v = round(safeNum(frac) * 100, d);
    return (v > 0 ? "+" : "") + v + "%";
  };

  /* ---- misc ---- */
  const escapeHtml = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const uid = (prefix = "") =>
    prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // deterministic PRNG (mulberry32) so generated sample data is stable
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function downloadCSV(filename, rows) {
    const csv = rows
      .map((r) => r.map((c) => {
        const s = c == null ? "" : String(c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(","))
      .join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  global.Utils = {
    safeNum, sum, avg, safeDiv, pctVal, round, clamp, stddev, pctChange,
    fmtNum, fmtBDT, fmtCr, fmtLac, fmtPct, fmtPctDelta, fmtSignedPct,
    escapeHtml, uid, mulberry32, downloadCSV, MONTH_NAMES, MONTH_SHORT,
    CR, LAC,
  };
})(window);
