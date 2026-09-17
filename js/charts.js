/* =========================================================================
   charts.js — Chart.js wrappers (kept isolated from App state)
   -------------------------------------------------------------------------
   Each helper destroys any previous instance on the same canvas before
   re-drawing. If Chart.js failed to load (offline), a graceful note is shown.
   ========================================================================= */
(function (global) {
  "use strict";
  const U = global.Utils;

  const _c = {}; // canvasId -> Chart instance

  function hasChart() { return typeof global.Chart !== "undefined"; }

  function baseOpts(extra) {
    const o = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350 },
      plugins: {
        legend: { labels: { usePointStyle: true, boxWidth: 8, font: { size: 11, family: "Inter" } } },
        tooltip: { backgroundColor: "#0B1F33", padding: 10, cornerRadius: 8, titleFont: { size: 12 } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { grid: { color: "#eef1f5" }, ticks: { font: { size: 11 } } },
      },
    };
    if (extra) Object.assign(o, extra);
    return o;
  }

  function render(canvasId, config) {
    const el = document.getElementById(canvasId);
    if (!el) return null;
    if (_c[canvasId]) { try { _c[canvasId].destroy(); } catch (e) {} _c[canvasId] = null; }
    if (!hasChart()) {
      el.parentElement.innerHTML = '<div class="note" style="padding:20px">Chart library unavailable (offline).</div>';
      return null;
    }
    _c[canvasId] = new global.Chart(el.getContext("2d"), config);
    return _c[canvasId];
  }

  /* -------- national trend: target bar + actual line, modes -------- */
  function trend(canvasId, labels, target, actual, py, mode) {
    let datasets, title = "";
    if (mode === "mom") {
      datasets = [{
        type: "line", label: "MoM % (Actual)",
        data: actual.map((v, i) => (i ? U.pctChange(v, actual[i - 1]) * 100 : null)),
        borderColor: "#D99A00", backgroundColor: "#D99A00", tension: 0.3, pointRadius: 3,
      }];
    } else if (mode === "yoy") {
      const yoy = actual.map((v, i) => (i && py && py[i] ? U.pctChange(v, py[i]) * 100 : null));
      datasets = [{
        type: "bar", label: "YoY % (Actual vs PY)",
        data: yoy,
        backgroundColor: yoy.map((v) => (v == null ? "transparent" : v < 0 ? "#C83E4D" : "#16845B")),
        borderRadius: 4,
      }];
    } else {
      datasets = [
        { type: "bar", label: "Target", data: target, backgroundColor: "rgba(18,59,93,.18)", borderColor: "#123B5D", borderWidth: 1, borderRadius: 4, order: 2 },
        { type: "line", label: "Actual", data: actual, borderColor: "#16845B", backgroundColor: "#16845B", tension: 0.35, pointRadius: 3, order: 1 },
      ];
    }
    return render(canvasId, {
      data: { labels, datasets },
      options: baseOpts({ scales: { x: { grid: { display: false } }, y: { grid: { color: "#eef1f5" } } } }),
    });
  }

  /* -------- horizontal bars (gap decomposition) -------- */
  function hbar(canvasId, labels, data, colors, label) {
    return render(canvasId, {
      type: "bar",
      data: { labels, datasets: [{ label: label || "", data, backgroundColor: colors || "#D99A00", borderRadius: 4 }] },
      options: baseOpts({ indexAxis: "y", plugins: { legend: { display: false } } }),
    });
  }

  /* -------- grouped bars -------- */
  function bars(canvasId, labels, series) {
    const datasets = series.map((s) => ({
      label: s.label, data: s.data, backgroundColor: s.color,
      borderRadius: s.radius != null ? s.radius : 4, type: s.type || "bar",
      borderColor: s.borderColor, borderWidth: s.borderWidth || 0,
      order: s.order == null ? 2 : s.order, tension: s.tension, pointRadius: s.pointRadius,
    }));
    return render(canvasId, { data: { labels, datasets }, options: baseOpts() });
  }

  /* -------- scatter -------- */
  function scatter(canvasId, points, xTitle, yTitle) {
    return render(canvasId, {
      type: "scatter",
      data: { datasets: [{ label: "", data: points.map((p) => ({ x: p.x, y: p.y })), backgroundColor: points.map((p) => p.color), pointRadius: 8, pointHoverRadius: 10 }] },
      options: baseOpts({
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: !!xTitle, text: xTitle || "" }, grid: { color: "#eef1f5" } },
          y: { min: 0, max: 100, title: { display: !!yTitle, text: yTitle || "" }, grid: { color: "#eef1f5" } },
        },
      }),
    });
  }

  /* -------- multiline -------- */
  function multiline(canvasId, labels, datasets) {
    const ds = datasets.map((d) => ({
      label: d.label, data: d.data, borderColor: d.color, backgroundColor: d.color,
      tension: 0.3, pointRadius: 3, borderWidth: 2,
    }));
    return render(canvasId, { type: "line", data: { labels, datasets: ds }, options: baseOpts() });
  }

  /* -------- pareto -------- */
  function pareto(canvasId, labels, values, cum) {
    return render(canvasId, {
      data: {
        labels,
        datasets: [
          { type: "bar", label: "Sales (BDT)", data: values, backgroundColor: "#123B5D", borderRadius: 4, yAxisID: "y" },
          { type: "line", label: "Cumulative %", data: cum, borderColor: "#C83E4D", tension: 0.3, pointRadius: 2, yAxisID: "y1" },
        ],
      },
      options: baseOpts({
        scales: {
          y: { position: "left", grid: { color: "#eef1f5" } },
          y1: { position: "right", min: 0, max: 100, grid: { drawOnChartArea: false } },
          x: { grid: { display: false } },
        },
      }),
    });
  }

  function destroy(id) { if (_c[id]) { try { _c[id].destroy(); } catch (e) {} _c[id] = null; } }

  global.Charts = { trend, hbar, bars, scatter, multiline, pareto, render, destroy, baseOpts, hasChart };
})(window);
