/* =========================================================================
   map.js — interactive Bangladesh Zone Health Map (self-contained SVG)
   -------------------------------------------------------------------------
   No external tile/GeoJSON dependency -> cannot "break" when offline.
   Divisions are drawn as approximate geographic polygons; colour is driven
   by the health / signal engine (configurable), never subjective.
   ========================================================================= */
(function (global) {
  "use strict";
  const U = global.Utils;

  /* ---- projection (approx equirectangular) ---- */
  const W = 470, H = 600;
  const lonMin = 88.0, lonMax = 92.5, latMin = 20.9, latMax = 26.7;
  const px = (lng) => ((lng - lonMin) / (lonMax - lonMin)) * W;
  const py = (lat) => ((latMax - lat) / (latMax - latMin)) * H;
  const toPts = (poly) => poly.map((p) => [U.round(px(p[0]), 1), U.round(py(p[1]), 1)]);

  /* ---- approximate division polygons [lng, lat] ---- */
  const DIVISIONS = {
    "Rajshahi":    [[88.00,26.45],[89.60,26.50],[89.75,26.10],[89.80,25.50],[89.75,24.90],[89.70,24.40],[89.72,24.00],[89.00,23.95],[88.40,23.90],[88.00,23.80]],
    "Dhaka North": [[89.60,26.50],[91.00,26.55],[91.20,26.00],[91.30,25.40],[91.28,24.90],[91.22,24.40],[91.20,24.00],[89.72,24.00],[89.70,24.40],[89.75,24.90],[89.80,25.50],[89.75,26.10]],
    "Sylhet":      [[91.30,25.40],[92.20,25.15],[92.45,24.60],[92.35,24.10],[91.20,24.00],[91.22,24.40],[91.28,24.90]],
    "Khulna":      [[88.00,23.80],[88.40,23.90],[89.00,23.95],[89.72,24.00],[89.85,23.30],[89.60,22.40],[89.20,21.80],[88.70,21.30],[88.15,21.40],[88.00,22.00]],
    "Dhaka South": [[89.72,24.00],[91.20,24.00],[91.10,23.30],[90.80,22.70],[90.45,22.20],[90.00,21.95],[89.90,22.60],[89.85,23.30]],
    "Chittagong":  [[91.20,24.00],[92.35,24.10],[92.30,23.20],[92.10,22.20],[92.00,21.40],[91.40,21.60],[91.10,22.00],[91.10,23.30]],
  };
  const LABELS = {
    "Rajshahi":    [89.0, 24.95],
    "Dhaka North": [90.5, 25.25],
    "Sylhet":      [91.9, 24.70],
    "Khulna":      [89.0, 22.65],
    "Dhaka South": [90.4, 23.05],
    "Chittagong":  [91.75, 22.70],
  };

  const COUNTRY_OUTLINE = [
    [88.00,26.45],[89.60,26.50],[91.00,26.55],[91.20,26.00],[91.30,25.40],[92.20,25.15],[92.45,24.60],
    [92.35,24.10],[92.30,23.20],[92.10,22.20],[92.00,21.40],[91.40,21.60],[91.10,22.00],[90.80,22.70],
    [90.45,22.20],[90.00,21.95],[89.90,22.60],[89.60,22.40],[89.20,21.80],[88.70,21.30],[88.15,21.40],[88.00,22.00],
  ];

  let container = null;
  let onZoneClick = null;
  let currentColorFn = null;
  let currentLabelFn = null;
  let pathByDivision = {};
  let label2ByDivision = {};
  let tip = null;

  function pathD(poly) { return "M" + toPts(poly).map((p) => p[0] + "," + p[1]).join(" L") + " Z"; }

  function build(elId, opts) {
    opts = opts || {};
    container = document.getElementById(elId);
    if (!container) return;
    onZoneClick = opts.onZoneClick || null;
    currentColorFn = opts.colorFn || (() => "#94a3b8");
    currentLabelFn = opts.labelFn || (() => "");
    pathByDivision = {};
    label2ByDivision = {};

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Bangladesh zone health map");

    const country = document.createElementNS(svgNS, "path");
    country.setAttribute("d", pathD(COUNTRY_OUTLINE));
    country.setAttribute("fill", "#eef1f5");
    country.setAttribute("stroke", "var(--navy)");
    country.setAttribute("stroke-width", "2.5");
    country.setAttribute("stroke-linejoin", "round");
    svg.appendChild(country);

    const g = document.createElementNS(svgNS, "g");
    Object.keys(DIVISIONS).forEach((name) => {
      const d = document.createElementNS(svgNS, "path");
      d.setAttribute("class", "division");
      d.setAttribute("data-division", name);
      d.setAttribute("d", pathD(DIVISIONS[name]));
      d.setAttribute("stroke", "var(--white)");
      d.setAttribute("stroke-width", "1.6");
      d.setAttribute("stroke-linejoin", "round");
      pathByDivision[name] = d;
      g.appendChild(d);

      const lp = LABELS[name] || [0, 0];
      const lbl = document.createElementNS(svgNS, "text");
      lbl.setAttribute("x", U.round(px(lp[0]), 1));
      lbl.setAttribute("y", U.round(py(lp[1]), 1));
      lbl.setAttribute("text-anchor", "middle");
      lbl.setAttribute("class", "lbl");
      lbl.textContent = name;
      g.appendChild(lbl);

      const lbl2 = document.createElementNS(svgNS, "text");
      lbl2.setAttribute("x", U.round(px(lp[0]), 1));
      lbl2.setAttribute("y", U.round(py(lp[1]), 1) + 13);
      lbl2.setAttribute("text-anchor", "middle");
      lbl2.setAttribute("class", "lbl2");
      lbl2.textContent = "";
      label2ByDivision[name] = lbl2;
      g.appendChild(lbl2);
    });
    svg.appendChild(g);

    const outline = document.createElementNS(svgNS, "path");
    outline.setAttribute("d", pathD(COUNTRY_OUTLINE));
    outline.setAttribute("fill", "none");
    outline.setAttribute("stroke", "var(--navy)");
    outline.setAttribute("stroke-width", "2.5");
    outline.setAttribute("stroke-linejoin", "round");
    outline.setAttribute("pointer-events", "none");
    svg.appendChild(outline);

    container.classList.add("zonemap-wrap");
    container.innerHTML = "";
    container.appendChild(svg);

    if (!tip) {
      tip = document.createElement("div");
      tip.className = "zonemap-tip";
      document.body.appendChild(tip);
    }

    Object.keys(pathByDivision).forEach((name) => {
      const d = pathByDivision[name];
      d.addEventListener("mousemove", (e) => {
        tip.style.display = "block";
        tip.style.left = (e.clientX + 14) + "px";
        tip.style.top = (e.clientY + 14) + "px";
        tip.innerHTML = "<b>" + name + "</b>";
        if (currentLabelFn) tip.innerHTML += "<br/>" + currentLabelFn(name);
      });
      d.addEventListener("mouseleave", () => { tip.style.display = "none"; });
      d.addEventListener("click", () => { if (onZoneClick) onZoneClick(name); });
    });

    update();
  }

  function update(colorFn, labelFn) {
    if (colorFn) currentColorFn = colorFn;
    if (labelFn) currentLabelFn = labelFn;
    if (!container) return;
    Object.keys(pathByDivision).forEach((name) => {
      pathByDivision[name].setAttribute("fill", currentColorFn ? currentColorFn(name) : "#94a3b8");
      pathByDivision[name].setAttribute("fill-opacity", "0.82");
      label2ByDivision[name].textContent = currentLabelFn ? currentLabelFn(name) : "";
    });
  }

  function highlight(name) {
    Object.keys(pathByDivision).forEach((nm) => {
      pathByDivision[nm].setAttribute("opacity", name && nm !== name ? "0.35" : "1");
    });
  }

  function clearHighlight() {
    Object.keys(pathByDivision).forEach((nm) => pathByDivision[nm].setAttribute("opacity", "1"));
  }

  global.ZoneMap = { build, update, highlight, clearHighlight, DIVISIONS, LABELS, px, py };
})(window);
