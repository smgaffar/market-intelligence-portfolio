/* =========================================================================
   app.js — application shell: state, routing, filters, rendering, drawers,
   search, notifications, export, drill-down.
   ========================================================================= */
(function (global) {
  "use strict";
  const U = global.Utils;
  const D = global.Data;
  const S = global.Signals;
  const C = global.Charts;
  const M = global.ZoneMap;
  const CFG = D.CONFIG;

  /* ============================ STATE ============================ */
  const App = {
    page: "overview",
    filters: { month: D.CUR, view: "mtd", product: "", sku: "", zone: "", region: "", territory: "", channel: "" },
    mapView: "health",
    trendMode: "monthly",
    sort: { col: "gap", dir: -1 },
    tablePage: 0,
    drill: { zone: null, region: null, territory: null },
    _notifHits: [],
    _searchHits: [],
  };
  const PAGE_SIZE = 12;

  /* ============================ FILTER / SCOPE ============================ */
  function aggMonth(list, field) {
    const n = D.MONTHS.length;
    const arr = new Array(n).fill(0);
    list.forEach((e) => {
      const a = e[field];
      if (a) a.forEach((v, i) => { arr[i] += U.safeNum(v); });
    });
    return arr;
  }
  function mixFactor() {
    const f = App.filters;
    const bulkTarget = U.sum(D.PRODUCTS.map((p) => p.target));
    if (f.sku) {
      const sk = D.SKUS.find((s) => s.name === f.sku);
      if (sk) return sk.noTarget ? 0 : U.safeDiv(sk.target, bulkTarget);
    }
    if (f.product) {
      const p = D.PRODUCTS.find((p) => p.name === f.product);
      if (p) return U.safeDiv(p.target, bulkTarget);
    }
    return null;
  }
  function scope() {
    const f = App.filters;
    let targetArr, actualArr, level = "national", label = "Bangladesh", entity = null;
    if (f.territory) {
      const t = D.TERRITORIES.find((x) => x.name === f.territory);
      if (t) { targetArr = t.target.slice(); actualArr = t.actual.slice(); level = "territory"; label = t.name; entity = t; }
    } else if (f.region) {
      const rs = D.TERRITORIES.filter((x) => x.region === f.region);
      if (rs.length) { targetArr = aggMonth(rs, "target"); actualArr = aggMonth(rs, "actual"); level = "region"; label = f.region; }
    } else if (f.zone) {
      const z = D.zoneByName(f.zone);
      if (z) { targetArr = z.target.slice(); actualArr = z.actual.slice(); level = "zone"; label = z.name; entity = z; }
    }
    if (!targetArr) { targetArr = aggMonth(D.ZONES, "target"); actualArr = aggMonth(D.ZONES, "actual"); }
    const mix = mixFactor();
    if (mix !== null) {
      targetArr = targetArr.map((v) => v * mix);
      actualArr = actualArr.map((v) => v * mix);
    }
    return { targetArr, actualArr, level, label, entity, mix };
  }
  function windowRange() {
    const m = App.filters.month;
    const from = App.filters.view === "ytd" ? 0 : m;
    return { from, to: m };
  }
  function scopeMetrics() {
    const s = scope();
    const { from, to } = windowRange();
    const t = U.sum(s.targetArr.slice(from, to + 1));
    const a = U.sum(s.actualArr.slice(from, to + 1));
    const prevA = from > 0 ? U.sum(s.actualArr.slice(from - 1, to)) : 0;
    const mom = prevA > 0 ? U.pctChange(a, prevA) : 0;
    return { ...s, t, a, achv: U.pctVal(a, t), gap: t - a, mom };
  }

  function filteredSignals() {
    const f = App.filters;
    if (f.zone) return S.SIGNALS.filter((s) => s.zone === f.zone);
    return S.SIGNALS;
  }

  /* ============================ ENTITY METRICS ============================ */
  function entMetrics(e) {
    const t = U.sum(e.target), a = U.sum(e.actual);
    const cur = U.pctVal(e.actual[D.CUR], e.target[D.CUR]);
    const prev = D.CUR > 0 ? U.pctVal(e.actual[D.CUR - 1], e.target[D.CUR - 1]) : 0;
    const mom = D.CUR > 0 ? U.pctChange(e.actual[D.CUR], e.actual[D.CUR - 1]) : 0;
    return { t, a, achv: U.pctVal(a, t), gap: t - a, cur, prev, mom };
  }
  const zoneMetrics = S.zoneMetrics;

  /* ============================ SMALL RENDER HELPERS ============================ */
  const esc = U.escapeHtml;
  function kpi(label, value, sub, cls) { return `<div class="kpi ${cls || ""}"><div class="l">${label}</div><div class="v">${value}</div><div class="s">${sub}</div></div>`; }
  function pill(text, cls) { return `<span class="pill ${cls || "info"}">${esc(text)}</span>`; }
  function achvPill(frac) {
    if (frac == null) return pill("No target", "nodata");
    if (frac >= 1) return pill(U.fmtPct(frac), "pos");
    if (frac >= CFG.perfThreshold) return pill(U.fmtPct(frac), "pos");
    if (frac >= CFG.criticalThreshold) return pill(U.fmtPct(frac), "warn");
    return pill(U.fmtPct(frac), "neg");
  }
  function sevPill(sev) { return pill(S.SEV_LABEL[sev] || sev, sev === "critical" ? "crit" : sev === "warning" ? "warn" : sev === "watch" ? "neg" : "info"); }
  function statusPill(status) {
    const map = { "Open": "info", "In Progress": "warn", "Completed": "pos", "Overdue": "crit", "Monitoring": "warn", "Closed": "pos", "Improved": "pos", "No change": "neg" };
    return pill(status, map[status] || "info");
  }
  const RULE_LEGEND = `<div class="rule-legend">
    <span class="fact">FACT</span><span class="signal">SIGNAL</span><span class="hypo">HYPOTHESIS</span><span class="valid">VALIDATED FINDING</span><span class="impact">BUSINESS IMPACT</span><span class="action">ACTION</span>
  </div>`;

  function healthBadge(zone) {
    const h = S.health(zone);
    return `<span class="pill" style="background:${h.color}22;color:${h.color}">${h.level}</span>`;
  }

  /* ============================ DRAWER ============================ */
  function openDrawer(title, body) {
    document.getElementById("drawerTitle").textContent = title;
    document.getElementById("drawerBody").innerHTML = body;
    document.getElementById("drawer").classList.add("open");
    document.getElementById("overlay").classList.add("show");
  }
  function closeDrawer() {
    document.getElementById("drawer").classList.remove("open");
    document.getElementById("overlay").classList.remove("show");
  }
  function entityDrawer(title, badgeHtml, metricRows, extraHtml) {
    return `<div style="margin-bottom:14px">${badgeHtml}</div>
    <div class="kpis" style="grid-template-columns:1fr 1fr">
      ${kpi("Target", metricRows.target, "window")}
      ${kpi("Actual", metricRows.actual, "window")}
      ${kpi("Achievement", metricRows.achv, "actual ÷ target")}
      ${kpi("Sales Gap", metricRows.gap, "target − actual")}
    </div>
    <div class="card" style="box-shadow:none;border:none;padding:0;margin-bottom:12px"><h3>Metrics</h3>
      <table><tbody>${metricRows.rows.map((r) => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td></tr>`).join("")}</tbody></table></div>
    ${extraHtml}`;
  }

  /* ============================ PAGES ============================ */
  const MAP_VIEW_SEG = `<div class="mapview" id="mapViewSeg"><div class="seg">
    <button class="on" data-v="health">Signal Health</button><button data-v="achievement">Achievement</button><button data-v="gap">Sales Gap</button><button data-v="critical">Critical Signals</button><button data-v="impact">Business Impact</button></div></div>
    <div class="legend"><span><i class="dot" style="background:#16845B"></i>Healthy</span><span><i class="dot" style="background:#D99A00"></i>Watch</span><span><i class="dot" style="background:#E8833A"></i>At Risk</span><span><i class="dot" style="background:#C83E4D"></i>Critical</span></div>`;

  function managementSummary() {
    const m = scopeMetrics();
    const sigs = filteredSignals();
    const below = D.ZONES.filter((z) => S.health(z).level !== "Healthy").length;
    const critZ = D.ZONES.filter((z) => S.health(z).level === "Critical").length;
    const worst = [...D.ZONES].sort((a, b) => S.zoneMetrics(a).achv - S.zoneMetrics(b).achv)[0];
    const catMap = {};
    sigs.forEach((s) => { catMap[s.type] = (catMap[s.type] || 0) + 1; });
    const cats = Object.keys(catMap).map((k) => k + " (" + catMap[k] + ")").join(", ");
    return `<div class="insight-box">
      <div class="cap">Management Intelligence Summary</div>
      <b>${App.filters.view.toUpperCase()}</b> achievement is <b style="color:#35c39a">${U.fmtPct(m.achv)}</b> for <b>${m.label}</b>, with a sales gap of <b>${U.fmtBDT(m.gap)}</b>.
      <b>${critZ}</b> of ${D.ZONES.length} zones are <b>Critical</b> and <b>${below}</b> are not Healthy on the signal-driven health model.
      The weakest zone is <b>${worst.name}</b> (${U.fmtPct(S.zoneMetrics(worst).achv)}).
      <b>${sigs.filter((s) => s.sev === "critical").length}</b> critical and <b>${sigs.length}</b> total signals require attention (${cats || "none"}).
      <b>${D.RESEARCH.filter((r) => r.status !== "Closed").length}</b> research cases open, <b>${D.ACTIONS.filter((a) => a.status === "Overdue").length}</b> actions overdue.</div>`;
  }

  const PAGES = {};

  /* ---------- 01 Executive Overview ---------- */
  PAGES.overview = function () {
    const m = scopeMetrics();
    const sigs = filteredSignals();
    const crit = sigs.filter((s) => s.sev === "critical").length;
    const researchOpen = D.RESEARCH.filter((r) => r.status !== "Closed").length;
    const overdue = D.ACTIONS.filter((a) => a.status === "Overdue").length;
    const winLabel = App.filters.view === "ytd" ? "YTD" : D.MONTHS[App.filters.month].short;
    return `<div class="kpis">
      ${kpi("Actual Sales", U.fmtBDT(m.a), `${m.label} · ${winLabel} 2026`, "accent")}
      ${kpi("Target Sales", U.fmtBDT(m.t), "target", "")}
      ${kpi("Achievement", U.fmtPct(m.achv), "actual ÷ target", m.achv >= CFG.perfThreshold ? "good" : "warn")}
      ${kpi("Sales Gap", U.fmtBDT(m.gap), "target − actual", m.gap > 0 ? "warn" : "good")}
      ${kpi("Active Signals", sigs.length, crit + " critical", crit ? "bad" : "")}
      ${kpi("Research Queue", researchOpen, "open CI/R&I cases", "")}
      ${kpi("Actions Overdue", overdue, "past deadline", overdue ? "warn" : "good")}
    </div>
    ${managementSummary()}
    <div class="grid g23" style="margin-top:16px">
      <div class="card"><h3>National Sales Trend</h3><div class="hint">Toggle monthly / MoM / YoY</div>
        <div class="seg" id="trendSeg" style="margin-bottom:10px"><button class="on" data-t="monthly">Monthly</button><button data-t="mom">MoM</button><button data-t="yoy">YoY</button></div>
        <div class="chart"><canvas id="trendChart"></canvas></div></div>
      <div class="card"><h3>Management Scoreboard</h3><div class="hint">Current vs previous period</div>${scoreboard()}</div>
    </div>
    <div class="grid g2">
      <div class="card"><h3>Zone Health Map</h3><div class="hint">Click a zone for its intelligence drawer · signal-driven health</div>
        ${MAP_VIEW_SEG}
        <div id="zoneMap" style="height:360px;border-radius:10px"></div></div>
      <div class="card"><h3>Sales Gap Decomposition</h3><div class="hint">Where is the gap coming from?</div><div class="chart"><canvas id="gapChart"></canvas></div></div>
    </div>`;
  };

  function scoreboard() {
    const m = scopeMetrics();
    const natA = U.sum(scope().actualArr);
    const natT = U.sum(scope().targetArr);
    const rows = [
      ["Sales", U.fmtBDT(m.a), U.fmtBDT(m.a / 1.05), U.fmtSignedPct(0.05), "pos"],
      ["Achievement", U.fmtPct(m.achv), U.fmtPct(m.achv - 0.02), U.fmtPctDelta(0.02), m.achv - 0.02 > 0 ? "pos" : "neg"],
      ["Sales Gap", U.fmtBDT(m.gap), U.fmtBDT(m.gap * 0.94), U.fmtSignedPct(0.06), m.gap > 0 ? "neg" : "pos"],
      ["Active Customers", U.fmtNum(D.CUSTOMERS.filter((c) => c.status !== "Lost").length), U.fmtNum(D.CUSTOMERS.length), "+" + U.fmtNum(D.CUSTOMERS.filter((c) => c.status === "New").length), "pos"],
      ["Employee Productivity", U.fmtPct(U.avg(D.EMPLOYEES.map((e) => U.pctVal(U.sum(e.actual), U.sum(e.target))))), "61%", "+2 pp", "pos"],
      ["Critical Signals", S.criticalCount(), S.criticalCount() - 1, "+1", S.criticalCount() ? "neg" : "pos"],
    ];
    return `<table><thead><tr><th>KPI</th><th class="num">Current</th><th class="num">Previous</th><th class="num">Change</th><th>Status</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td><b>${r[0]}</b></td><td class="num">${r[1]}</td><td class="num">${r[2]}</td><td class="num">${r[3]}</td><td>${r[4] === "pos" ? pill("Improving", "pos") : r[4] === "neg" ? pill("Deteriorating", "neg") : pill("Stable", "warn")}</td></tr>`).join("")}</tbody></table>`;
  }

  /* ---------- 02 Sales Performance ---------- */
  PAGES.sales = function () {
    const rows = buildSalesRows();
    const sorted = sortRows(rows);
    const page = paginate(sorted);
    return `<div class="exportbar">
      <button class="btn" data-action="export-csv">&#11015; Export CSV</button>
      <button class="btn ghost" onclick="window.print()">&#128424; Print</button>
      <span class="note">Columns sortable · click a row to open detail</span></div>
    <div class="card"><h3>Sales Performance Table</h3><div class="hint">Zone → Region → Territory → Employee · conditional formatting by achievement</div>
      <div class="grid g23">
        <div class="card" style="box-shadow:none;border:none;padding:0"><h3>Category Performance (Bulk)</h3><div class="chart sm"><canvas id="catChart"></canvas></div></div>
        <div class="card" style="box-shadow:none;border:none;padding:0"><h3>SKU Achievement (Top / Bottom)</h3><div class="chart sm"><canvas id="skuChart"></canvas></div></div>
      </div>
      <div style="overflow-x:auto"><table id="salesTbl"><thead><tr>
        ${["name:Zone", "region:Region", "target:Target", "actual:Actual", "gap:Gap", "achv:Achv%", "mom:MoM", "pers:Persistence", "sig:Signals", "health:Health"].map((c) => {
          const [key, label] = c.split(":");
          const arrow = App.sort.col === key ? (App.sort.dir === 1 ? " ▲" : " ▼") : "";
          return `<th class="${key === "name" || key === "region" || key === "health" ? "" : "num"}${App.sort.col === key ? " sorted" : ""}" data-action="sort" data-col="${key}">${label}${arrow}</th>`;
        }).join("")}
      </tr></thead>
      <tbody>${page.map((r) => `<tr class="clickable" data-action="open-zone" data-zone="${esc(r.name)}">
        <td><b>${esc(r.name)}</b></td><td class="num">${esc(r.region)}</td>
        <td class="num">${r.target}</td><td class="num">${r.actual}</td><td class="num">${r.gap}</td>
        <td class="num"><b>${r.achvHtml}</b></td><td class="num" style="color:${r.momVal < 0 ? "var(--neg)" : "var(--pos)"}">${r.mom}</td>
        <td class="num">${r.persistence} mo</td><td class="num">${r.sigCount}</td><td>${r.health}</td></tr>`).join("")}</tbody></table></div>
      ${pager(sorted.length)}
    </div>
    <div class="card" style="margin-top:16px"><h3>SKU Detail (Bulk)</h3><div class="hint">${D.SKUS.length} SKUs · (C) = no target set · zero-target handled</div>
      <div style="overflow-x:auto"><table><thead><tr><th>SKU</th><th>Category</th><th>Pack</th><th class="num">Target</th><th class="num">Sales</th><th class="num">Achv%</th></tr></thead>
      <tbody>${D.SKUS.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.category)}</td><td>${esc(s.pack)}</td><td class="num">${s.noTarget ? "—" : U.fmtBDT(s.target)}</td><td class="num">${U.fmtBDT(s.sales)}</td><td class="num">${s.noTarget ? pill("No target", "nodata") : achvPill(s.achv)}</td></tr>`).join("")}</tbody></table></div></div>`;
  };

  function buildSalesRows() {
    return D.ZONES.map((z) => {
      const m = zoneMetrics(z);
      const h = S.health(z);
      const sigs = S.signalsForZone(z.name);
      return {
        name: z.name, region: z.region, level: "zone",
        target: U.fmtBDT(m.totalTarget), actual: U.fmtBDT(m.totalActual),
        targetVal: m.totalTarget, actualVal: m.totalActual, achvVal: m.achv, gapVal: m.gap,
        gap: U.fmtBDT(m.gap), achv: m.achv, achvHtml: achvPill(m.achv), mom: U.fmtSignedPct(m.mom), momVal: m.mom,
        persistence: m.persistence, sigCount: sigs.length, health: healthBadge(z), healthVal: m.achv,
      };
    });
  }
  function sortRows(rows) {
    const { col, dir } = App.sort;
    const keyMap = { name: "name", region: "region", target: "targetVal", actual: "actualVal", gap: "gapVal", achv: "achvVal", mom: "momVal", pers: "persistence", sig: "sigCount", health: "healthVal" };
    const k = keyMap[col] || "gapVal";
    return [...rows].sort((a, b) => {
      const va = a[k], vb = b[k];
      if (typeof va === "string") return va.localeCompare(vb) * dir;
      return (va - vb) * dir;
    });
  }
  function paginate(rows) {
    const start = App.tablePage * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }
  function pager(total) {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    return `<div class="pagination"><button data-action="page" data-d="-1" ${App.tablePage === 0 ? "disabled" : ""}>‹ Prev</button><span>Page ${App.tablePage + 1} of ${pages}</span><button data-action="page" data-d="1" ${App.tablePage + 1 >= pages ? "disabled" : ""}>Next ›</button></div>`;
  }

  /* ---------- 03 Geographic Intelligence ---------- */
  PAGES.geo = function () {
    const d = App.drill;
    let crumbs = `<span class="c ${!d.zone ? "here" : ""}" data-action="geo" data-level="national">Bangladesh</span>`;
    if (d.zone) crumbs += `<span class="sep">→</span><span class="c ${!d.region ? "here" : ""}" data-action="geo" data-level="zone">${esc(d.zone)}</span>`;
    if (d.region) crumbs += `<span class="sep">→</span><span class="c ${!d.territory ? "here" : ""}" data-action="geo" data-level="region">${esc(d.region)}</span>`;
    if (d.territory) crumbs += `<span class="sep">→</span><span class="c here" data-action="geo" data-level="territory">${esc(d.territory)}</span>`;

    let body = "";
    if (d.territory) body = geoTerritoryView(d);
    else if (d.region) body = geoRegionView(d);
    else if (d.zone) body = geoZoneView(d);
    else body = geoNationalView();

    return `<div class="card"><h3>Geographic Intelligence</h3><div class="hint">Bangladesh → Zone → Region → Territory → Employee → Distributor → Customer</div>
      <div class="crumb">${crumbs}</div>
      ${MAP_VIEW_SEG}
      <div class="grid g32">
        <div class="card" style="box-shadow:none;border:none;padding:0"><div id="zoneMap" style="height:400px;border-radius:10px"></div></div>
        <div class="card" style="box-shadow:none;border:none;padding:0">${body}</div>
      </div></div>`;
  };

  function geoNationalView() {
    return `<h3>Zones (${D.ZONES.length})</h3><div class="hint">Click a row to drill into region</div>
      <table><thead><tr><th>Zone</th><th class="num">Target</th><th class="num">Actual</th><th class="num">Achv%</th><th>Health</th></tr></thead>
      <tbody>${D.ZONES.map((z) => { const m = zoneMetrics(z); return `<tr class="clickable" data-action="geo" data-level="zone" data-zone="${esc(z.name)}"><td><b>${esc(z.name)}</b></td><td class="num">${U.fmtBDT(m.totalTarget)}</td><td class="num">${U.fmtBDT(m.totalActual)}</td><td class="num">${achvPill(m.achv)}</td><td>${healthBadge(z)}</td></tr>`; }).join("")}</tbody></table>`;
  }
  function geoZoneView(d) {
    const z = D.zoneByName(d.zone);
    const m = zoneMetrics(z);
    const regions = D.regionsOf(d.zone);
    return `<h3>${esc(d.zone)}</h3><div class="hint">${U.fmtPct(m.achv)} achievement · ${healthBadge(z)} · click a region to drill</div>
      <table><thead><tr><th>Region</th><th class="num">Target</th><th class="num">Actual</th><th class="num">Achv%</th></tr></thead>
      <tbody>${regions.map((r) => { const rm = entMetrics(r); return `<tr class="clickable" data-action="geo" data-level="region" data-zone="${esc(d.zone)}" data-region="${esc(r.name)}"><td><b>${esc(r.name)}</b></td><td class="num">${U.fmtBDT(rm.t)}</td><td class="num">${U.fmtBDT(rm.a)}</td><td class="num">${achvPill(rm.achv)}</td></tr>`; }).join("")}</tbody></table>`;
  }
  function geoRegionView(d) {
    const terrs = D.territoriesOf(d.region);
    return `<h3>${esc(d.region)}</h3><div class="hint">${terrs.length} territories · click to drill into territory</div>
      <table><thead><tr><th>Territory</th><th class="num">Target</th><th class="num">Actual</th><th class="num">Achv%</th></tr></thead>
      <tbody>${terrs.map((t) => { const tm = entMetrics(t); return `<tr class="clickable" data-action="geo" data-level="territory" data-zone="${esc(d.zone)}" data-region="${esc(d.region)}" data-territory="${esc(t.name)}"><td><b>${esc(t.name)}</b></td><td class="num">${U.fmtBDT(tm.t)}</td><td class="num">${U.fmtBDT(tm.a)}</td><td class="num">${achvPill(tm.achv)}</td></tr>`; }).join("")}</tbody></table>`;
  }
  function geoTerritoryView(d) {
    const emps = D.employeesOfTerritory(d.territory);
    const dist = D.distributorOfTerritory(d.territory);
    const custs = D.customersOfTerritory(d.territory);
    return `<h3>${esc(d.territory)}</h3>
      <div class="hint">Employees · distributor · customers</div>
      <h4 style="margin:10px 0 4px;font-size:12px">Employees</h4>
      <table><thead><tr><th>Employee</th><th class="num">Target</th><th class="num">Actual</th><th class="num">Achv%</th></tr></thead>
      <tbody>${emps.map((e) => { const em = entMetrics(e); return `<tr class="clickable" data-action="open-employee" data-id="${e.id}"><td>${esc(e.name)}</td><td class="num">${U.fmtBDT(em.t)}</td><td class="num">${U.fmtBDT(em.a)}</td><td class="num">${achvPill(em.achv)}</td></tr>`; }).join("")}</tbody></table>
      ${dist ? `<h4 style="margin:12px 0 4px;font-size:12px">Distributor</h4><table><thead><tr><th>Distributor</th><th class="num">Stock (days)</th><th class="num">Coverage</th></tr></thead><tbody><tr class="clickable" data-action="open-distributor" data-id="${dist.id}"><td>${esc(dist.name)}</td><td class="num">${dist.stockDays}</td><td class="num">${dist.coverage}%</td></tr></tbody></table>` : ""}
      <h4 style="margin:12px 0 4px;font-size:12px">Customers (${custs.length})</h4>
      <table><thead><tr><th>Customer</th><th>Type</th><th class="num">Sales</th></tr></thead>
      <tbody>${custs.map((c) => `<tr class="clickable" data-action="open-customer" data-id="${c.id}"><td>${esc(c.name)}</td><td>${esc(c.type)}</td><td class="num">${U.fmtBDT(U.sum(c.actual))}</td></tr>`).join("")}</tbody></table>`;
  }

  /* ---------- 04 Manpower Intelligence ---------- */
  PAGES.manpower = function () {
    const emps = App.filters.zone ? D.EMPLOYEES.filter((e) => e.zone === App.filters.zone) : D.EMPLOYEES;
    const low = emps.filter((e) => U.pctVal(U.sum(e.actual), U.sum(e.target)) < 0.5).length;
    const avgProd = U.avg(emps.map((e) => U.pctVal(U.sum(e.actual), U.sum(e.target))));
    return `<div class="kpis">
      ${kpi("Total Employees", emps.length, "SRs mapped", "")}
      ${kpi("Average Productivity", U.fmtPct(avgProd), "actual ÷ target", avgProd >= CFG.perfThreshold ? "good" : "warn")}
      ${kpi("Low Productivity (<50%)", low, "below 50% achievement", low ? "bad" : "good")}
    </div>
    <div class="grid g2">
      <div class="card"><h3>Employee Productivity Matrix</h3><div class="hint">X = target, Y = achievement · red &lt;50%, amber &lt;60%</div><div class="chart"><canvas id="prodChart"></canvas></div></div>
      <div class="card"><h3>Employee Table</h3><div class="hint">Click to open employee detail</div>
        <table><thead><tr><th>Employee</th><th>Zone</th><th>Territory</th><th class="num">Target</th><th class="num">Actual</th><th class="num">Achv%</th></tr></thead>
        <tbody>${emps.slice(0, 20).map((e) => { const em = entMetrics(e); return `<tr class="clickable" data-action="open-employee" data-id="${e.id}"><td><b>${esc(e.name)}</b></td><td>${esc(e.zone)}</td><td>${esc(e.territory)}</td><td class="num">${U.fmtBDT(em.t)}</td><td class="num">${U.fmtBDT(em.a)}</td><td class="num">${achvPill(em.achv)}</td></tr>`; }).join("")}</tbody></table></div>
    </div>`;
  };

  /* ---------- 05 Customer Intelligence ---------- */
  PAGES.customer = function () {
    let custs = D.CUSTOMERS;
    if (App.filters.zone) custs = custs.filter((c) => c.zone === App.filters.zone);
    if (App.filters.channel) custs = custs.filter((c) => c.channel === App.filters.channel);
    const active = custs.filter((c) => c.status !== "Lost");
    const lost = custs.filter((c) => c.status === "Lost");
    const newC = custs.filter((c) => c.status === "New");
    const sorted = [...active].sort((a, b) => b.totalActual - a.totalActual);
    const totalSales = U.sum(active.map((c) => c.totalActual));
    const topShare = U.safeDiv(sorted[0] ? sorted[0].totalActual : 0, totalSales);
    return `<div class="kpis">
      ${kpi("Active Customers", active.length, "of " + custs.length + " total", "good")}
      ${kpi("New Customers", newC.length, "acquisitions", "")}
      ${kpi("Lost Customers", lost.length, "churn", lost.length ? "warn" : "good")}
      ${kpi("Top Customer Share", U.fmtPct(topShare), "concentration", topShare > CFG.topCustomerShare ? "warn" : "good")}
    </div>
    <div class="grid g2">
      <div class="card"><h3>Customer Pareto</h3><div class="hint">Sales contribution & concentration risk</div><div class="chart"><canvas id="paretoChart"></canvas></div></div>
      <div class="card"><h3>Distributor Dependency</h3><div class="hint">Top distributor share per zone (configurable threshold ${(CFG.distributorDependency * 100)}%)</div>
        <table><thead><tr><th>Zone</th><th class="num">Top Dist. Share</th><th>Status</th></tr></thead>
        <tbody>${D.ZONES.map((z) => { const td = S.topDistributorShare(z); return `<tr><td>${esc(z.name)}</td><td class="num">${U.fmtPct(td)}</td><td>${td > CFG.distributorDependency ? pill("Dependency", "warn") : pill("OK", "pos")}</td></tr>`; }).join("")}</tbody></table></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Customer Table</h3><div class="hint">Click to open customer detail</div>
      <div style="overflow-x:auto"><table><thead><tr><th>Customer</th><th>Zone</th><th>Territory</th><th>Type</th><th class="num">Sales</th><th class="num">Freq</th><th>Status</th></tr></thead>
      <tbody>${sorted.slice(0, 30).map((c) => `<tr class="clickable" data-action="open-customer" data-id="${c.id}"><td><b>${esc(c.name)}</b></td><td>${esc(c.zone)}</td><td>${esc(c.territory)}</td><td>${esc(c.type)}</td><td class="num">${U.fmtBDT(c.totalActual)}</td><td class="num">${c.freq}</td><td>${statusPill(c.status)}</td></tr>`).join("")}</tbody></table></div></div>`;
  };

  /* ---------- 06 Competitor Intelligence ---------- */
  PAGES.competitor = function () {
    return `<div class="card"><h3>Competitor Intelligence</h3><div class="hint">Price gap vs AEL · availability · distribution · pressure (sample audit data)</div>
      <div class="chart" style="height:280px"><canvas id="compChart"></canvas></div>
      <table style="margin-top:12px"><thead><tr><th>Competitor</th><th>Focus</th><th class="num">Price Gap %</th><th class="num">Availability</th><th class="num">Distribution</th><th>Promo</th><th class="num">Pressure</th><th>Status</th></tr></thead>
      <tbody>${D.COMPETITORS.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.focus)}</td><td class="num" style="color:${Math.abs(c.priceGap) >= CFG.priceGapWarnPct ? "var(--neg)" : "var(--slate)"}">${c.priceGap}%</td><td class="num">${c.avail}%</td><td class="num">${c.dist}%</td><td>${esc(c.promo)}</td><td class="num">${(c.pressure * 100).toFixed(0)}%</td><td>${c.pressure >= 0.65 ? pill("High", "crit") : c.pressure >= 0.45 ? pill("Medium", "warn") : pill("Low", "pos")}</td></tr>`).join("")}</tbody></table>
      <div class="note" style="margin-top:10px">Pressure = availability × distribution × promo × price-gap severity (configurable). Sample audit data.</div></div>`;
  };

  /* ---------- 07 Market Intelligence ---------- */
  PAGES.market = function () {
    const ms = D.MARKET_SERIES;
    const d = ms.demandIndex, p = ms.priceIndex, v = ms.aelVolumeIndex;
    const dChg = d[d.length - 1] - d[d.length - 2];
    const pChg = p[p.length - 1] - p[p.length - 2];
    return `<div class="kpis">
      ${kpi("Demand Index", d[d.length - 1], dChg > 0 ? "rising" : "falling", dChg < 0 ? "warn" : "good")}
      ${kpi("Market Price Index", p[p.length - 1], pChg > 0 ? "rising (input cost)" : "stable", pChg > 0 ? "warn" : "")}
      ${kpi("AEL Volume Index", v[v.length - 1], "vs market demand", v[v.length - 1] < d[d.length - 1] ? "warn" : "good")}
    </div>
    <div class="grid g2">
      <div class="card"><h3>Market Trend (12M)</h3><div class="hint">Demand, price & AEL volume index</div><div class="chart"><canvas id="marketChart"></canvas></div></div>
      <div class="card"><h3>Market Signals</h3><div class="hint">External demand / supply / price</div>
        ${["Seasonal demand shift (Q3 monsoon)", "Wheat / rice input price rising", "Competitor promotional activity increasing", "Supply disruption risk (transport)", "By-product (bran) price movement"].map((s, i) => `<div style="padding:9px 0;border-bottom:1px solid var(--line);font-size:13px;display:flex;gap:8px;align-items:center">${i < 2 ? pill("Warning", "warn") : pill("Info", "info")} ${s}</div>`).join("")}</div>
    </div>`;
  };

  /* ---------- 08 Sales Signal Center ---------- */
  PAGES.signals = function () {
    const sigs = filteredSignals();
    return `${RULE_LEGEND}
    <div class="grid g23">
      <div class="card"><h3>Sales Signal Center</h3><div class="hint">Auto-generated exception signals · severity highlighted · click to open</div>
        <div class="sigs">${sigs.map((s) => signalCard(s)).join("")}</div></div>
      <div class="card"><h3>Priority Matrix</h3><div class="hint">Business impact vs evidence / uncertainty</div><div class="chart"><canvas id="priorityChart"></canvas></div>
        <div class="legend" style="margin-top:10px"><span><i class="dot" style="background:var(--crit)"></i>Immediate</span><span><i class="dot" style="background:var(--warn)"></i>Priority</span><span><i class="dot" style="background:var(--risk)"></i>Monitor</span><span><i class="dot" style="background:var(--blue)"></i>Low</span></div></div>
    </div>`;
  };
  function signalCard(s) {
    return `<div class="sig sev-${s.sev}" data-action="open-signal" data-id="${s.id}">
      <div class="top"><span class="id">${s.id} · ${s.type}</span><span class="sev">${S.SEV_LABEL[s.sev]}</span></div>
      <div class="t">${esc(s.title)}</div>
      <div class="m">${esc(s.zone)} · ${esc(s.metric)} ${esc(s.cur)} (prev ${esc(s.prev)}) · ${s.persistence} mo</div>
      <div class="foot"><span class="pill info">Impact ${esc(s.impact)}</span><span class="pill ${s.sev === "critical" ? "crit" : s.sev === "warning" ? "warn" : "info"}">${esc(s.research)}</span></div>
      <div class="statusline"><span>Evidence: <b>${esc(s.evidence)}</b></span><span>Research: <b>${esc(s.research)}</b></span><span>Action: <b>${esc(s.action)}</b></span></div>
    </div>`;
  }

  /* ---------- 09 Root Cause Analysis ---------- */
  PAGES.rootcause = function () {
    const totalGap = U.sum(D.ZONES.map((z) => zoneMetrics(z).gap));
    return `${RULE_LEGEND}
    <div class="card"><h3>Root Cause Analysis</h3><div class="hint">Drill from gap to root cause — Internal / External / Structural</div>
    <div class="tree">
      <div class="node">SALES GAP — ${U.fmtBDT(totalGap)} (bulk, 3M)</div>
      <div class="branch">
        <div class="node">GEOGRAPHY</div>
        <div class="branch">${D.ZONES.map((z) => { const m = zoneMetrics(z); return `<div class="leaf"><span>${esc(z.name)}</span><b>${U.fmtBDT(m.gap)} · ${U.fmtPct(m.achv)}</b></div>`; }).join("")}</div>
        <div class="node">ROOT CAUSE CATEGORIES (hypotheses — unvalidated)</div>
        <div class="branch">
          <div class="leaf"><span><b>INTERNAL</b> — distributor / coverage / manpower / execution</span><b>36%</b></div>
          <div class="leaf"><span><b>EXTERNAL</b> — competitor / market / customer behaviour / seasonality</span><b>34%</b></div>
          <div class="leaf"><span><b>STRUCTURAL</b> — territory design / portfolio / distribution model</span><b>30%</b></div>
        </div>
      </div>
    </div>
    <div class="note" style="margin-top:12px">&#9888; Category percentages are <b>HYPOTHESES</b> — not validated. Only evidence triangulation confirms a root cause.</div></div>`;
  };

  /* ---------- 10 CI Research Queue ---------- */
  PAGES.research = function () {
    return `${RULE_LEGEND}
    <div class="card"><h3>CI Research Queue</h3><div class="hint">Signal → business question → hypothesis → evidence → method → owner → deadline</div>
      <table><thead><tr><th>ID</th><th>Signal</th><th>Business Question</th><th>Method</th><th>Owner</th><th>Deadline</th><th>Status</th></tr></thead>
      <tbody>${D.RESEARCH.map((r) => `<tr class="clickable" data-action="open-research" data-id="${r.id}"><td>${r.id}</td><td>${pill(r.signal, "info")}</td><td>${esc(r.question)}</td><td>${esc(r.method)}</td><td>${esc(r.owner)}</td><td>${esc(r.deadline)}</td><td>${statusPill(r.status)}</td></tr>`).join("")}</tbody></table></div>
    <div class="card" style="margin-top:16px"><h3>Evidence Triangulation</h3><div class="hint">Sources & confidence — never present an unvalidated hypothesis as a confirmed root cause</div>
      <table><thead><tr><th>Finding</th><th>Sources</th><th class="num">Count</th><th>Confidence</th><th>Status</th></tr></thead>
      <tbody>
        <tr><td>Rajshahi coverage gap</td><td>Field observation, SR audit</td><td class="num">2</td><td>${pill("High", "pos")}</td><td>Validated</td></tr>
        <tr><td>Sylhet competitor price advantage</td><td>Price audit, retailer</td><td class="num">2</td><td>${pill("Medium", "warn")}</td><td>Validating</td></tr>
        <tr><td>Dhaka North customer loss</td><td>Retailer interview</td><td class="num">1</td><td>${pill("Low", "neg")}</td><td>Unvalidated</td></tr>
      </tbody></table></div>`;
  };

  /* ---------- 11 Business Impact ---------- */
  PAGES.impact = function () {
    const totalGap = U.sum(D.ZONES.map((z) => zoneMetrics(z).gap));
    const loss = totalGap * CFG.impactRecoverableRate;
    const opp = totalGap * CFG.impactOpportunityRate;
    const custRisk = totalGap * 0.25;
    const depZones = D.ZONES.filter((z) => S.topDistributorShare(z) > CFG.distributorDependency).length;
    return `<div class="kpis">
      ${kpi("Sales Loss (est.)", U.fmtBDT(loss), "recoverable portion of gap", "bad")}
      ${kpi("Recovery Opportunity", U.fmtBDT(opp), "if gap closes to plan", "good")}
      ${kpi("Customer Value at Risk", U.fmtBDT(custRisk), "top-customer exposure", "warn")}
      ${kpi("Distributor Dependency", depZones + " zones", "top distributor > " + (CFG.distributorDependency * 100) + "%", depZones ? "warn" : "good")}
    </div>
    <div class="card"><h3>Business Impact by Signal</h3><div class="hint">Signal → root cause → affected sales → estimated impact → recovery opportunity</div>
      <table><thead><tr><th>Signal</th><th>Type</th><th>Zone</th><th class="num">Est. Impact</th><th class="num">Recovery Opp.</th></tr></thead>
      <tbody>${filteredSignals().filter((s) => s.impactCr > 0).sort((a, b) => b.impactCr - a.impactCr).slice(0, 12).map((s) => `<tr class="clickable" data-action="open-signal" data-id="${s.id}"><td>${pill(s.id, "info")} ${esc(s.title)}</td><td>${esc(s.type)}</td><td>${esc(s.zone)}</td><td class="num">${esc(s.impact)}</td><td class="num">${U.fmtBDT(s.impactCr * U.CR * CFG.impactOpportunityRate)}</td></tr>`).join("")}</tbody></table></div>`;
  };

  /* ---------- 12 Management Action ---------- */
  PAGES.action = function () {
    return `<div class="card"><h3>Management Action Tracker</h3><div class="hint">Issue → action → owner → deadline → expected impact → status</div>
      <table><thead><tr><th>ID</th><th>Issue</th><th>Action</th><th>Owner</th><th>Deadline</th><th class="num">Expected Impact</th><th>Status</th></tr></thead>
      <tbody>${D.ACTIONS.map((a) => `<tr class="clickable" data-action="open-action" data-id="${a.id}"><td>${a.id}</td><td>${esc(a.issue)}</td><td>${esc(a.action)}</td><td>${esc(a.owner)}</td><td>${esc(a.deadline)}</td><td class="num">${esc(a.impact)}</td><td>${statusPill(a.status)}</td></tr>`).join("")}</tbody></table>
      <div class="note" style="margin-top:10px">Overdue actions highlighted in red. Statuses: Open · In Progress · Completed · Overdue · Monitoring · Closed.</div></div>`;
  };

  /* ---------- 13 Impact Monitoring ---------- */
  PAGES.monitor = function () {
    return `<div class="card"><h3>Impact Monitoring</h3><div class="hint">Before → action → after · observed improvement (no unproven causality)</div>
      <table><thead><tr><th>Zone</th><th class="num">Before</th><th>Action</th><th class="num">After</th><th class="num">Δ</th><th>Outcome</th></tr></thead>
      <tbody>${D.MONITORING.map((m) => { const dlt = m.after - m.before; return `<tr><td><b>${esc(m.zone)}</b></td><td class="num">${m.before}%</td><td>${esc(m.action)}</td><td class="num">${m.after}%</td><td class="num" style="color:${dlt >= 0 ? "var(--pos)" : "var(--neg)"}">${dlt >= 0 ? "+" : ""}${dlt} pp</td><td>${m.status === "Improved" ? pill("Observed Improvement", "pos") : m.status === "Monitoring" ? pill("Under Monitoring", "warn") : pill(m.status, "neg")}</td></tr>`; }).join("")}</tbody></table>
      <div class="chart sm" style="height:260px;margin-top:12px"><canvas id="monitorChart"></canvas></div></div>`;
  };

  /* ---------- 14 Data Quality ---------- */
  PAGES.quality = function () {
    const total = D.DATA_QUALITY.find((q) => q.check === "Total records").count;
    const valid = D.DATA_QUALITY.find((q) => q.check === "Valid records").count;
    const score = U.round(U.safeDiv(valid, total) * 100, 0);
    return `<div class="kpis">
      ${kpi("Data Quality Score", score + "/100", "transparent: valid ÷ total", score >= 95 ? "good" : "warn")}
      ${kpi("Total Records", U.fmtNum(total), "bulk sales records", "")}
      ${kpi("Last Refresh", "16 Sep 2026", "daily ERP sync", "")}
    </div>
    <div class="card"><h3>Data Validation</h3><div class="hint">Records, validity & mapping completeness</div>
      <table><thead><tr><th>Check</th><th class="num">Count</th><th class="num">Rate</th><th>Status</th></tr></thead>
      <tbody>${D.DATA_QUALITY.map((i) => `<tr><td>${i.check}</td><td class="num">${U.fmtNum(i.count)}</td><td class="num">${i.rate == null ? "—" : U.fmtPct(i.rate)}</td><td>${statusPill(i.status === "pos" ? "OK" : i.status === "warn" ? "Review" : "Fix")}</td></tr>`).join("")}</tbody></table></div>`;
  };

  /* ============================ DRAWER RENDERERS ============================ */
  function zoneDrawer(z) {
    const m = zoneMetrics(z);
    const h = S.health(z);
    const sigs = S.signalsForZone(z.name);
    const dist = D.DISTRIBUTORS.filter((d) => d.zone === z.name);
    const rows = [
      ["MoM (actual)", U.fmtSignedPct(m.mom)],
      ["YoY (value)", U.fmtSignedPct(m.yoy)],
      ["Persistence", m.persistence + " months below " + U.fmtPct(CFG.perfThreshold)],
      ["Volatility", U.fmtPct(m.volatility)],
      ["Health score", h.score + "/100"],
      ["Top distributor share", U.fmtPct(S.topDistributorShare(z))],
      ["Open signals", String(sigs.length)],
      ["Distributors", String(dist.length)],
    ];
    const comps = h.components;
    const compHtml = `<div class="card" style="box-shadow:none;border:none;padding:0;margin-bottom:12px"><h3>Health Model (configurable)</h3>
      <table><tbody>${Object.keys(comps).map((k) => `<tr><td>${k[0].toUpperCase() + k.slice(1)} (weight ${(CFG.health[k] * 100).toFixed(0)}%)</td><td class="num">${comps[k]}</td></tr>`).join("")}</tbody></table></div>`;
    const topSigs = sigs.slice(0, 5).map((s) => signalCard(s)).join("") || '<div style="color:var(--muted)">No active signals</div>';
    return entityDrawer(z.name, `${healthBadge(z)} ${pill(z.region + " Division", "info")}`,
      { target: U.fmtBDT(m.totalTarget), actual: U.fmtBDT(m.totalActual), achv: U.fmtPct(m.achv), gap: U.fmtBDT(m.gap), rows },
      compHtml + `<div class="card" style="box-shadow:none;border:none;padding:0"><h3>Top Signals</h3>${topSigs}</div>`);
  }
  function employeeDrawer(e) {
    const m = entMetrics(e);
    const rows = [["Territory", e.territory], ["Zone", e.zone], ["Efficiency factor", (e.efficiency * 100).toFixed(0) + "%"]];
    const custs = D.customersOfTerritory(e.territory);
    return entityDrawer(e.name, pill("Employee / SR", "info"),
      { target: U.fmtBDT(m.t), actual: U.fmtBDT(m.a), achv: U.fmtPct(m.achv), gap: U.fmtBDT(m.gap), rows },
      `<div class="card" style="box-shadow:none;border:none;padding:0"><h3>Territory Customers</h3><table><thead><tr><th>Customer</th><th class="num">Sales</th></tr></thead><tbody>${custs.map((c) => `<tr class="clickable" data-action="open-customer" data-id="${c.id}"><td>${esc(c.name)}</td><td class="num">${U.fmtBDT(c.totalActual)}</td></tr>`).join("")}</tbody></table></div>`);
  }
  function distributorDrawer(d) {
    const rows = [["Territory", d.territory], ["Zone", d.zone], ["Stock cover", d.stockDays + " days"], ["Credit", d.creditDays + " days"], ["Coverage", d.coverage + "%"]];
    return entityDrawer(d.name, pill("Distributor", "info"),
      { target: "—", actual: "—", achv: "—", gap: "—", rows }, "");
  }
  function customerDrawer(c) {
    const m = entMetrics(c);
    const rows = [["Territory", c.territory], ["Zone", c.zone], ["Type", c.type], ["Channel", c.channel], ["Purchase freq", c.freq + " / quarter"], ["SKUs bought", String(c.skus)], ["Last activity", c.lastActivityDays + " days ago"], ["Status", c.status]];
    return entityDrawer(c.name, pill(c.type, "info"),
      { target: U.fmtBDT(m.t), actual: U.fmtBDT(m.a), achv: U.fmtPct(m.achv), gap: U.fmtBDT(m.gap), rows }, "");
  }
  function regionDrawer(r) {
    const m = entMetrics(r);
    const terrs = D.territoriesOf(r.name);
    return entityDrawer(r.name, pill("Region", "info"),
      { target: U.fmtBDT(m.t), actual: U.fmtBDT(m.a), achv: U.fmtPct(m.achv), gap: U.fmtBDT(m.gap), rows: [["Zone", r.zone], ["Territories", String(terrs.length)]] },
      `<div class="card" style="box-shadow:none;border:none;padding:0"><h3>Territories</h3><table><tbody>${terrs.map((t) => { const tm = entMetrics(t); return `<tr class="clickable" data-action="open-territory" data-id="${t.id}"><td>${esc(t.name)}</td><td class="num">${U.fmtPct(tm.achv)}</td></tr>`; }).join("")}</tbody></table></div>`);
  }
  function territoryDrawer(t) {
    const m = entMetrics(t);
    return entityDrawer(t.name, pill("Territory", "info"),
      { target: U.fmtBDT(m.t), actual: U.fmtBDT(m.a), achv: U.fmtPct(m.achv), gap: U.fmtBDT(m.gap), rows: [["Zone", t.zone], ["Region", t.region]] }, "");
  }
  function signalDrawer(s) {
    return `<div style="margin-bottom:12px">${sevPill(s.sev)} ${pill(s.type, "info")} ${pill(s.priority, "hypo")}</div>
    <h3 style="margin:0 0 6px">${esc(s.title)}</h3>
    <div style="color:var(--muted);font-size:12.5px;margin-bottom:14px">${s.id} · ${esc(s.zone)} · detected ${esc(s.detected)}</div>
    <div class="card" style="box-shadow:none;border:none;padding:0;margin-bottom:12px"><h3>Signal Detail</h3>
      <table><tbody>
        <tr><td>Metric</td><td class="num">${esc(s.metric)}</td></tr>
        <tr><td>Current value</td><td class="num">${esc(s.cur)}</td></tr>
        <tr><td>Previous value</td><td class="num">${esc(s.prev)}</td></tr>
        <tr><td>Deviation</td><td class="num">${esc(s.dev)}</td></tr>
        <tr><td>Persistence</td><td class="num">${s.persistence} months</td></tr>
        <tr><td>Estimated impact</td><td class="num">${esc(s.impact)}</td></tr>
      </tbody></table></div>
    <div class="card" style="box-shadow:none;border:none;padding:0"><h3>Investigation</h3>
      <div style="font-size:12.5px;line-height:1.7">
        <b>Business question:</b> What is driving this ${esc(s.type.toLowerCase())} pattern?<br/>
        <b>Hypotheses (unvalidated):</b> customer loss · distributor stock · competitor price · manpower coverage · product availability<br/>
        <b>Evidence required:</b> sales trend · customer activity · distributor stock · competitor price · SR coverage<br/>
        <b>Evidence status:</b> ${statusPill(s.evidence === "Not started" ? "Open" : s.evidence)}<br/>
        <b>Research status:</b> ${statusPill(s.research)}<br/>
        <b>Action status:</b> ${statusPill(s.action)}
      </div></div>`;
  }
  function researchDrawer(r) {
    return `<div style="margin-bottom:12px">${pill(r.id, "info")} ${statusPill(r.status)}</div>
    <h3 style="margin:0 0 6px">${esc(r.question)}</h3>
    <div style="color:var(--muted);font-size:12px;margin-bottom:14px">Signal ${r.signal} · ${esc(r.method)} · owner ${esc(r.owner)} · deadline ${esc(r.deadline)}</div>
    <div class="card" style="box-shadow:none;border:none;padding:0;margin-bottom:12px"><h3>Hypotheses (unvalidated)</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${r.hypotheses.map((h) => pill(h, "hypo")).join("")}</div></div>
    <div class="card" style="box-shadow:none;border:none;padding:0"><h3>Evidence Required</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${r.evidenceRequired.map((e) => pill(e, "info")).join("")}</div>
      <div style="margin-top:12px;font-size:12.5px"><b>Confidence:</b> ${statusPill(r.confidence)} ${r.finding ? `<b>Finding:</b> ${esc(r.finding)}` : "<span class='note'>No validated finding yet.</span>"}</div></div>`;
  }
  function actionDrawer(a) {
    return `<div style="margin-bottom:12px">${pill(a.id, "info")} ${statusPill(a.status)}</div>
    <h3 style="margin:0 0 6px">${esc(a.issue)}</h3>
    <div style="color:var(--muted);font-size:12.5px;margin-bottom:14px">${esc(a.action)}</div>
    <table><tbody>
      <tr><td>Owner</td><td class="num">${esc(a.owner)}</td></tr>
      <tr><td>Deadline</td><td class="num">${esc(a.deadline)}</td></tr>
      <tr><td>Expected impact</td><td class="num">${esc(a.impact)}</td></tr>
    </tbody></table>`;
  }

  /* ============================ CHARTS DRAWING ============================ */
  function drawCharts() {
    const page = App.page;
    if (page === "overview") { drawTrend(); drawGap(); initMap("zoneMap", "overview"); }
    else if (page === "sales") { drawCategory(); drawSku(); }
    else if (page === "geo") { initMap("zoneMap", "geo"); }
    else if (page === "manpower") { drawProductivity(); }
    else if (page === "customer") { drawPareto(); }
    else if (page === "competitor") { drawCompetitor(); }
    else if (page === "market") { drawMarket(); }
    else if (page === "signals") { drawPriority(); }
    else if (page === "monitor") { drawMonitor(); }
  }

  function drawTrend() {
    const s = scope();
    const labels = D.MONTHS.map((m) => m.short);
    let py = s.actualArr.map((v, i) => v * (0.88 + i * 0.09));
    C.trend("trendChart", labels, s.targetArr, s.actualArr, py, App.trendMode);
  }
  function drawGap() {
    const s = scope();
    let labels, data, colors;
    if (s.level === "territory") {
      const emps = D.employeesOfTerritory(s.label);
      labels = emps.map((e) => e.name); data = emps.map((e) => entMetrics(e).gap); colors = data.map((g) => g > 0 ? "#C83E4D" : "#16845B");
    } else if (s.level === "region") {
      const ts = D.territoriesOf(s.label);
      labels = ts.map((t) => t.name); data = ts.map((t) => entMetrics(t).gap); colors = data.map((g) => g > 0 ? "#C83E4D" : "#16845B");
    } else if (s.level === "zone") {
      const rs = D.regionsOf(s.label);
      labels = rs.map((r) => r.name); data = rs.map((r) => entMetrics(r).gap); colors = data.map((g) => g > 0 ? "#C83E4D" : "#16845B");
    } else {
      const zs = D.ZONES.slice().sort((a, b) => zoneMetrics(b).gap - zoneMetrics(a).gap);
      labels = zs.map((z) => z.name); data = zs.map((z) => zoneMetrics(z).gap); colors = data.map((g) => g > 10 * U.CR ? "#C83E4D" : "#D99A00");
    }
    C.hbar("gapChart", labels, data, colors, "Sales Gap");
  }
  function drawCategory() {
    const labels = D.PRODUCTS.map((p) => p.name);
    C.bars("catChart", labels, [
      { label: "Target", data: D.PRODUCTS.map((p) => p.target), color: "rgba(18,59,93,.18)", borderColor: "#123B5D", borderWidth: 1, type: "bar" },
      { label: "Actual", data: D.PRODUCTS.map((p) => p.sales), color: "#16845B", type: "bar" },
    ]);
  }
  function drawSku() {
    const withTarget = D.SKUS.filter((s) => !s.noTarget).sort((a, b) => a.achv - b.achv);
    const worst = withTarget.slice(0, 8);
    const labels = worst.map((s) => s.name.length > 16 ? s.name.slice(0, 15) + "…" : s.name);
    C.hbar("skuChart", labels, worst.map((s) => s.achv * 100), worst.map((s) => (s.achv < CFG.criticalThreshold ? "#C83E4D" : s.achv < CFG.perfThreshold ? "#D99A00" : "#16845B")), "Achv% (lowest)");
  }
  function drawProductivity() {
    const emps = App.filters.zone ? D.EMPLOYEES.filter((e) => e.zone === App.filters.zone) : D.EMPLOYEES;
    const points = emps.map((e) => { const achv = U.pctVal(U.sum(e.actual), U.sum(e.target)); return { x: U.sum(e.target), y: achv * 100, color: achv < 0.5 ? "#C83E4D" : achv < CFG.perfThreshold ? "#D99A00" : "#16845B" }; });
    C.scatter("prodChart", points, "Target per employee (BDT)", "Achievement %");
  }
  function drawPareto() {
    let custs = D.CUSTOMERS;
    if (App.filters.zone) custs = custs.filter((c) => c.zone === App.filters.zone);
    if (App.filters.channel) custs = custs.filter((c) => c.channel === App.filters.channel);
    const sorted = custs.filter((c) => c.status !== "Lost").sort((a, b) => b.totalActual - a.totalActual).slice(0, 15);
    const tot = U.sum(sorted.map((c) => c.totalActual));
    let run = 0;
    const cum = sorted.map((c) => { run += c.totalActual; return U.round(U.safeDiv(run, tot) * 100, 1); });
    C.pareto("paretoChart", sorted.map((c) => c.name.replace("M/s ", "")), sorted.map((c) => c.totalActual), cum);
  }
  function drawCompetitor() {
    const labels = D.COMPETITORS.map((c) => c.name);
    C.bars("compChart", labels, [
      { label: "Price gap %", data: D.COMPETITORS.map((c) => c.priceGap), color: D.COMPETITORS.map((c) => (Math.abs(c.priceGap) >= CFG.priceGapWarnPct ? "#C83E4D" : "#123B5D")), radius: 3 },
      { label: "Availability", data: D.COMPETITORS.map((c) => c.avail), color: "rgba(18,59,93,.35)", radius: 3 },
      { label: "Distribution", data: D.COMPETITORS.map((c) => c.dist), color: "rgba(22,132,91,.5)", radius: 3 },
    ]);
  }
  function drawMarket() {
    C.multiline("marketChart", D.MARKET_MONTHS, [
      { label: "Demand index", data: D.MARKET_SERIES.demandIndex, color: "#123B5D" },
      { label: "Market price index", data: D.MARKET_SERIES.priceIndex, color: "#D99A00" },
      { label: "AEL volume index", data: D.MARKET_SERIES.aelVolumeIndex, color: "#16845B" },
    ]);
  }
  function drawPriority() {
    const sigs = filteredSignals();
    const sevY = { critical: 85, warning: 60, watch: 38, info: 18 };
    const sevC = { critical: "#8B1E2D", warning: "#D99A00", watch: "#E8833A", info: "#123B5D" };
    const points = sigs.map((s, i) => ({ x: 15 + (i % 8) * 11 + (s.sev === "critical" ? 5 : 0), y: sevY[s.sev] || 20, color: sevC[s.sev] || "#123B5D" }));
    C.scatter("priorityChart", points, "Evidence / Uncertainty →", "Business Impact →");
  }
  function drawMonitor() {
    const labels = D.MONITORING.map((m) => m.zone);
    C.bars("monitorChart", labels, [
      { label: "Before", data: D.MONITORING.map((m) => m.before), color: "rgba(18,59,93,.3)", radius: 3 },
      { label: "After", data: D.MONITORING.map((m) => m.after), color: "#16845B", radius: 3 },
    ]);
  }

  /* ============================ MAP ============================ */
  function initMap(elId, mode) {
    const onZoneClick = mode === "geo"
      ? (name) => { App.drill = { zone: name, region: null, territory: null }; App.render(); }
      : (name) => openDrawer(name, zoneDrawer(D.zoneByName(name)));
    M.build(elId, {
      onZoneClick,
      colorFn: mapColor,
      labelFn: mapLabel,
    });
    if (mode === "geo" && App.drill.zone) M.highlight(App.drill.zone);
  }
  function mapColor(name) {
    const z = D.zoneByName(name);
    if (!z) return "#94a3b8";
    const m = zoneMetrics(z);
    switch (App.mapView) {
      case "achievement": return m.achv >= 0.7 ? "#16845B" : m.achv >= CFG.perfThreshold ? "#D99A00" : m.achv >= CFG.criticalThreshold ? "#E8833A" : "#C83E4D";
      case "gap": return m.gap > 12 * U.CR ? "#C83E4D" : m.gap > 8 * U.CR ? "#E8833A" : m.gap > 5 * U.CR ? "#D99A00" : "#16845B";
      case "critical": { const n = S.signalsForZone(name).filter((s) => s.sev === "critical").length; return n ? "#C83E4D" : "#94a3b8"; }
      case "impact": { const zs = S.signalsForZone(name); if (!zs.length) return "#16845B"; return zs.some((s) => s.sev === "critical") ? "#C83E4D" : zs.some((s) => s.sev === "warning") ? "#E8833A" : "#D99A00"; }
      default: return S.health(z).color;
    }
  }
  function mapLabel(name) {
    const z = D.zoneByName(name);
    if (!z) return "";
    const m = zoneMetrics(z);
    switch (App.mapView) {
      case "achievement": return U.fmtPct(m.achv);
      case "gap": return U.fmtBDT(m.gap) + " gap";
      case "critical": return S.signalsForZone(name).filter((s) => s.sev === "critical").length + " critical";
      case "impact": return S.signalsForZone(name).length + " signals";
      default: return S.health(z).level;
    }
  }

  /* ============================ ACTIONS (delegation) ============================ */
  function handleAction(action, d) {
    switch (action) {
      case "nav": App.nav(d.pg); break;
      case "open-zone": openDrawer(d.zone, zoneDrawer(D.zoneByName(d.zone))); break;
      case "open-signal": openDrawer("Signal " + d.id, signalDrawer(S.SIGNALS.find((s) => s.id === d.id))); break;
      case "open-employee": openDrawer("Employee", employeeDrawer(D.EMPLOYEES.find((e) => e.id === d.id))); break;
      case "open-distributor": openDrawer("Distributor", distributorDrawer(D.DISTRIBUTORS.find((x) => x.id === d.id))); break;
      case "open-customer": openDrawer("Customer", customerDrawer(D.CUSTOMERS.find((c) => c.id === d.id))); break;
      case "open-territory": openDrawer("Territory", territoryDrawer(D.TERRITORIES.find((t) => t.id === d.id))); break;
      case "open-region": openDrawer("Region", regionDrawer(D.REGIONS.find((r) => r.id === d.id))); break;
      case "open-research": openDrawer("Research " + d.id, researchDrawer(D.RESEARCH.find((r) => r.id === d.id))); break;
      case "open-action": openDrawer("Action " + d.id, actionDrawer(D.ACTIONS.find((a) => a.id === d.id))); break;
      case "geo": {
        if (d.level === "national") { App.drill = { zone: null, region: null, territory: null }; }
        else if (d.level === "zone") { App.drill = { zone: d.zone, region: null, territory: null }; }
        else if (d.level === "region") { App.drill = { zone: d.zone, region: d.region, territory: null }; }
        else if (d.level === "territory") { App.drill = { zone: d.zone, region: d.region, territory: d.territory }; }
        App.nav("geo");
        break;
      }
      case "sort": {
        const col = d.col;
        App.sort = { col, dir: App.sort.col === col ? -App.sort.dir : (col === "name" || col === "region" ? 1 : -1) };
        App.tablePage = 0;
        App.render();
        break;
      }
      case "page": App.tablePage = U.clamp(App.tablePage + Number(d.d), 0, 999); App.render(); break;
      case "export-csv": exportSalesCSV(); break;
      case "map-view": App.mapView = d.v; M.update(mapColor, mapLabel); document.querySelectorAll("#mapViewSeg button").forEach((b) => b.classList.toggle("on", b.dataset.v === d.v)); break;
      case "trend-mode": App.trendMode = d.t; document.querySelectorAll("#trendSeg button").forEach((b) => b.classList.toggle("on", b.dataset.t === d.t)); drawTrend(); break;
    }
  }

  function exportSalesCSV() {
    const rows = [["Zone", "Region", "Target (BDT)", "Actual (BDT)", "Achievement %", "Gap (BDT)", "MoM %", "Persistence (mo)", "Health"]];
    D.ZONES.forEach((z) => {
      const m = zoneMetrics(z); const h = S.health(z);
      rows.push([z.name, z.region, m.totalTarget, m.totalActual, U.round(m.achv * 100, 1), m.gap, U.round(m.mom * 100, 1), m.persistence, h.level]);
    });
    U.downloadCSV("AEL_bulk_sales_performance.csv", rows);
  }

  /* ============================ SEARCH ============================ */
  function doSearch(q) {
    q = q.toLowerCase().trim();
    const box = document.getElementById("searchResults");
    if (!q) { box.innerHTML = ""; box.classList.remove("open"); return; }
    const res = [];
    const add = (group, name, sub, action, data) => res.push({ group, name, sub, action, data });
    D.ZONES.filter((z) => z.name.toLowerCase().includes(q)).forEach((z) => add("Zone", z.name, U.fmtPct(zoneMetrics(z).achv) + " · " + S.health(z).level, "open-zone", { zone: z.name }));
    D.REGIONS.filter((r) => r.name.toLowerCase().includes(q)).forEach((r) => add("Region", r.name, r.zone, "open-region", { id: r.id }));
    D.TERRITORIES.filter((t) => t.name.toLowerCase().includes(q)).forEach((t) => add("Territory", t.name, t.region, "open-territory", { id: t.id }));
    D.EMPLOYEES.filter((e) => e.name.toLowerCase().includes(q)).forEach((e) => add("Employee", e.name, e.zone, "open-employee", { id: e.id }));
    D.DISTRIBUTORS.filter((d) => d.name.toLowerCase().includes(q)).forEach((d) => add("Distributor", d.name, d.zone + " · " + d.stockDays + "d stock", "open-distributor", { id: d.id }));
    D.CUSTOMERS.filter((c) => c.name.toLowerCase().includes(q)).forEach((c) => add("Customer", c.name, c.zone + " · " + U.fmtBDT(c.totalActual), "open-customer", { id: c.id }));
    S.SIGNALS.filter((s) => (s.id + " " + s.title + " " + s.zone).toLowerCase().includes(q)).forEach((s) => add("Signal", s.id, s.title, "open-signal", { id: s.id }));
    D.RESEARCH.filter((r) => (r.id + " " + r.question).toLowerCase().includes(q)).forEach((r) => add("Research", r.id, r.question, "open-research", { id: r.id }));

    App._searchHits = res;
    const groups = {};
    res.forEach((r) => (groups[r.group] = groups[r.group] || []).push(r));
    let html = "";
    Object.keys(groups).forEach((g) => {
      html += `<div class="g">${g}</div>`;
      groups[g].forEach((r) => { const i = res.indexOf(r); html += `<div class="r" data-action="search-hit" data-i="${i}"><span>${esc(r.name)}</span><span style="color:var(--muted);font-size:11px">${esc(r.sub)}</span></div>`; });
    });
    box.innerHTML = html || '<div class="r"><span>No results</span></div>';
    box.classList.add("open");
  }

  /* ============================ NOTIFICATIONS ============================ */
  function renderNotifications() {
    const items = [];
    const add = (ic, bg, t, d, action, data) => items.push({ ic, bg, t, d, action, data });
    S.SIGNALS.filter((s) => s.sev === "critical").forEach((s) => add("&#128308;", "#fbeaec", "Critical Signal", s.zone + ": " + s.title, "open-signal", { id: s.id }));
    D.RESEARCH.filter((r) => r.status !== "Closed").forEach((r) => add("&#128992;", "#fdf3dd", "Research Case", r.question, "open-research", { id: r.id }));
    D.ACTIONS.filter((a) => a.status === "Overdue").forEach((a) => add("&#128993;", "#fdf3dd", "Overdue Action", a.issue, "open-action", { id: a.id }));
    add("&#128993;", "#fdf3dd", "Data Quality", "61 records missing target mapping", "nav", { pg: "quality" });
    S.SIGNALS.filter((s) => s.title.startsWith("Recovery")).forEach((s) => add("&#128994;", "#e6f4ee", "Recovery Signal", s.zone + " recovering", "open-signal", { id: s.id }));
    App._notifHits = items;
    return items.map((it, i) => `<div class="item" data-action="notif" data-i="${i}"><div class="ic" style="background:${it.bg}">${it.ic}</div><div class="tx"><b>${it.t}</b><span>${esc(it.d)}</span></div></div>`).join("") || '<div class="item"><div class="tx"><span>No alerts</span></div></div>';
  }

  /* ============================ FILTERS ============================ */
  function populateFilters() {
    const fMonth = document.getElementById("fMonth");
    D.MONTHS.forEach((m, i) => { const o = document.createElement("option"); o.value = i; o.textContent = m.label; fMonth.appendChild(o); });
    fMonth.value = D.CUR;

    const fProduct = document.getElementById("fProduct");
    D.PRODUCTS.forEach((p) => { const o = document.createElement("option"); o.value = p.name; o.textContent = p.name; fProduct.appendChild(o); });

    const fSku = document.getElementById("fCategory");
    D.SKUS.forEach((s) => { const o = document.createElement("option"); o.value = s.name; o.textContent = s.name; fSku.appendChild(o); });

    const fZone = document.getElementById("fZone");
    D.ZONES.forEach((z) => { const o = document.createElement("option"); o.value = z.name; o.textContent = z.name; fZone.appendChild(o); });

    const fChannel = document.getElementById("fChannel");
    D.CHANNELS.forEach((c) => { const o = document.createElement("option"); o.value = c; o.textContent = c; fChannel.appendChild(o); });
  }

  function populateRegionFilter(zoneName) {
    const fRegion = document.getElementById("fRegion");
    fRegion.innerHTML = '<option value="">All Regions</option>';
    const regions = zoneName ? D.regionsOf(zoneName) : D.REGIONS;
    const seen = new Set();
    regions.forEach((r) => { if (!seen.has(r.name)) { seen.add(r.name); const o = document.createElement("option"); o.value = r.name; o.textContent = r.name; fRegion.appendChild(o); } });
  }
  function populateTerritoryFilter(regionName) {
    const fTerritory = document.getElementById("fTerritory");
    fTerritory.innerHTML = '<option value="">All Territories</option>';
    const terrs = regionName ? D.territoriesOf(regionName) : D.TERRITORIES;
    const seen = new Set();
    terrs.forEach((t) => { if (!seen.has(t.name)) { seen.add(t.name); const o = document.createElement("option"); o.value = t.name; o.textContent = t.name; fTerritory.appendChild(o); } });
  }

  /* ============================ RENDER ============================ */
  App.nav = function (pg) {
    App.page = pg;
    document.querySelectorAll("#menu a[data-pg]").forEach((a) => a.classList.toggle("active", a.dataset.pg === pg));
    document.getElementById("periodLabel").textContent = (App.filters.view === "ytd" ? "YTD" : D.MONTHS[App.filters.month].label) + " · " + App.filters.view.toUpperCase();
    App.render();
  };
  App.render = function () {
    document.getElementById("content").innerHTML = `<div class="page on">${PAGES[App.page]()}</div>`;
    drawCharts();
    document.getElementById("content").scrollTop = 0;
  };

  App.applyFilters = function () {
    App.tablePage = 0;
    App.render();
  };
  App.resetFilters = function () {
    App.filters = { month: D.CUR, view: "mtd", product: "", sku: "", zone: "", region: "", territory: "", channel: "" };
    App.drill = { zone: null, region: null, territory: null };
    document.getElementById("fMonth").value = D.CUR;
    document.getElementById("fProduct").value = "";
    document.getElementById("fCategory").value = "";
    document.getElementById("fZone").value = "";
    document.getElementById("fChannel").value = "";
    document.querySelectorAll("#fView button").forEach((b) => b.classList.toggle("on", b.dataset.v === "mtd"));
    populateRegionFilter("");
    populateTerritoryFilter("");
    App.render();
  };

  /* ============================ INIT ============================ */
  function init() {
    // menu
    document.getElementById("menu").addEventListener("click", (e) => { const a = e.target.closest("a[data-pg]"); if (a) App.nav(a.dataset.pg); });

    // drawer
    document.getElementById("overlay").addEventListener("click", closeDrawer);
    document.getElementById("drawerClose").addEventListener("click", closeDrawer);
    document.getElementById("themeBtn").addEventListener("click", () => { document.body.classList.toggle("dark"); document.getElementById("themeBtn").textContent = document.body.classList.contains("dark") ? "\u2600\uFE0F" : "\u{1F319}"; });

    // notifications
    document.getElementById("notifBtn").addEventListener("click", () => document.getElementById("notifPanel").classList.toggle("open"));
    document.getElementById("notifCount").textContent = S.criticalCount();
    document.getElementById("notifPanel").innerHTML = renderNotifications();

    // filters
    populateFilters();
    populateRegionFilter("");
    populateTerritoryFilter("");
    document.getElementById("fMonth").addEventListener("change", (e) => { App.filters.month = Number(e.target.value); App.applyFilters(); });
    document.getElementById("fProduct").addEventListener("change", (e) => { App.filters.product = e.target.value; App.filters.sku = ""; document.getElementById("fCategory").value = ""; App.applyFilters(); });
    document.getElementById("fCategory").addEventListener("change", (e) => { App.filters.sku = e.target.value; App.filters.product = ""; document.getElementById("fProduct").value = ""; App.applyFilters(); });
    document.getElementById("fZone").addEventListener("change", (e) => { App.filters.zone = e.target.value; App.filters.region = ""; App.filters.territory = ""; populateRegionFilter(e.target.value); populateTerritoryFilter(""); App.applyFilters(); });
    document.getElementById("fRegion").addEventListener("change", (e) => { App.filters.region = e.target.value; App.filters.territory = ""; populateTerritoryFilter(e.target.value); App.applyFilters(); });
    document.getElementById("fTerritory").addEventListener("change", (e) => { App.filters.territory = e.target.value; App.applyFilters(); });
    document.getElementById("fChannel").addEventListener("change", (e) => { App.filters.channel = e.target.value; App.applyFilters(); });
    document.getElementById("fView").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; App.filters.view = b.dataset.v; document.querySelectorAll("#fView button").forEach((x) => x.classList.toggle("on", x.dataset.v === b.dataset.v)); App.applyFilters(); });
    document.getElementById("resetFilters").addEventListener("click", App.resetFilters);

    // search
    document.getElementById("fSearch").addEventListener("input", (e) => doSearch(e.target.value));
    document.addEventListener("click", (e) => { if (!e.target.closest(".searchbox")) { document.getElementById("searchResults").classList.remove("open"); } });

    // global action delegation
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const action = el.dataset.action;
      const data = { ...el.dataset };
      delete data.action;
      if (action === "search-hit") { const hit = App._searchHits[Number(data.i)]; document.getElementById("searchResults").classList.remove("open"); document.getElementById("fSearch").value = ""; if (hit) handleAction(hit.action, hit.data); return; }
      if (action === "notif") { document.getElementById("notifPanel").classList.remove("open"); const it = App._notifHits[Number(data.i)]; if (it) handleAction(it.action, it.data); return; }
      if (action === "map-view") { handleAction("map-view", data); return; }
      if (action === "trend-mode") { handleAction("trend-mode", data); return; }
      handleAction(action, data);
    });

    App.nav("overview");
  }

  document.addEventListener("DOMContentLoaded", init);
  global.App = App;
})(window);
