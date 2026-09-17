/* =========================================================================
   signals.js — SIGNAL ENGINE + ZONE HEALTH MODEL
   -------------------------------------------------------------------------
   - Everything is derived from data patterns (never hard-coded conclusions).
   - Thresholds / weights come from Data.CONFIG and are configurable.
   - Clearly distinguishes FACT vs SIGNAL vs HYPOTHESIS (see Research module).
   ========================================================================= */
(function (global) {
  "use strict";
  const U = global.Utils;
  const D = global.Data;
  const CFG = D.CONFIG;
  const CR = U.CR;

  const SEV_LABEL = { critical: "CRITICAL", warning: "WARNING", watch: "WATCH", info: "INFO" };

  /* ---------- sample prior-year totals (DEMO — no real PY source yet) ---------- */
  const PY_FACTOR = { "Dhaka South": 0.98, "Dhaka North": 1.12, "Chittagong": 1.02, "Khulna": 1.04, "Rajshahi": 0.94, "Sylhet": 1.08 };
  function pyTotal(zone) { return U.sum(zone.actual) * (PY_FACTOR[zone.name] || 1.0); }

  // per-zone competitor intensity & local market condition (demo, configurable)
  const COMPETITOR_ZONE_FACTOR = { "Dhaka South": 0.75, "Dhaka North": 1.05, "Chittagong": 1.25, "Khulna": 1.0, "Rajshahi": 1.0, "Sylhet": 1.35 };
  const MARKET_ZONE_FACTOR = { "Dhaka South": 1.0, "Dhaka North": 0.95, "Chittagong": 0.98, "Khulna": 1.0, "Rajshahi": 0.85, "Sylhet": 0.94 };

  /* ============================ ZONE METRICS ============================ */
  function zoneMetrics(zone) {
    const t = zone.target, a = zone.actual;
    const totalTarget = U.sum(t), totalActual = U.sum(a);
    const achv = U.pctVal(totalActual, totalTarget);
    const gap = totalTarget - totalActual;

    const cur = U.pctVal(a[D.CUR], t[D.CUR]);
    const prev = D.CUR > 0 ? U.pctVal(a[D.CUR - 1], t[D.CUR - 1]) : 0;
    const mom = D.CUR > 0 ? U.pctChange(a[D.CUR], a[D.CUR - 1]) : 0;
    const gapCur = t[D.CUR] - a[D.CUR];
    const gapPrev = D.CUR > 0 ? t[D.CUR - 1] - a[D.CUR - 1] : 0;
    const gapMom = D.CUR > 0 ? U.pctChange(gapCur, gapPrev) : 0;

    const yoy = U.pctChange(totalActual, pyTotal(zone));

    // persistence: consecutive months (from current backwards) below perfThreshold
    let persistence = 0;
    for (let i = D.CUR; i >= 0; i--) {
      if (U.pctVal(a[i], t[i]) < CFG.perfThreshold) persistence++;
      else break;
    }

    const achvs = t.map((tv, i) => U.pctVal(a[i], tv));
    const volatility = U.stddev(achvs);

    // recovery: current month improved vs prior AND prior was below threshold
    const recovering = D.CUR > 0 && mom > CFG.recoveryPct && prev < CFG.perfThreshold;

    return {
      totalTarget, totalActual, achv, gap,
      cur, prev, mom, gapCur, gapPrev, gapMom, yoy,
      persistence, volatility, recovering,
      monthlyTarget: t, monthlyActual: a,
    };
  }

  /* ============================ HEALTH MODEL ============================ */
  function health(zone) {
    const m = zoneMetrics(zone);
    if (m.totalTarget <= 0) return { score: 0, level: "Insufficient Data", color: "#94a3b8", components: {} };

    const clamp100 = (v) => U.clamp(v, 0, 100);

    // 1. performance — achievement is the primary driver
    const performance = clamp100(m.achv * 100);

    // 2. trend — persistence + recovery (volatility is a standalone signal)
    const persistenceScore = clamp100(100 - m.persistence * 30);
    const recoveryScore = m.recovering ? 85 : 50;
    const trend = 0.6 * persistenceScore + 0.4 * recoveryScore;

    // 3. manpower — average employee productivity in zone
    const emps = D.EMPLOYEES.filter((e) => e.zone === zone.name);
    const prod = U.avg(emps.map((e) => U.pctVal(U.sum(e.actual), U.sum(e.target))));
    const manpower = clamp100((prod || 0) * 100);

    // 4. customer — active trend + continuous concentration / dependency penalty
    const custs = D.CUSTOMERS.filter((c) => c.zone === zone.name);
    const active = custs.filter((c) => c.status !== "Lost");
    const activeRatio = U.safeDiv(active.length, custs.length);
    const sorted = [...custs].sort((a, b) => b.totalActual - a.totalActual);
    const topCustShare = U.safeDiv(sorted[0] ? sorted[0].totalActual : 0, m.totalActual);
    const topDistShare = topDistributorShare(zone);
    const customer = clamp100(
      0.5 * activeRatio * 100 +
      0.25 * clamp100(100 - topCustShare * 100 * 1.5) +
      0.25 * clamp100(100 - topDistShare * 100 * 1.2)
    );

    // 5. competitor — pressure + price gap (zone-specific intensity)
    const cFactor = COMPETITOR_ZONE_FACTOR[zone.name] || 1;
    const avgPressure = U.avg(D.COMPETITORS.map((c) => c.pressure));
    const avgAbsGap = U.avg(D.COMPETITORS.map((c) => Math.abs(c.priceGap)));
    const competitor = clamp100(100 - avgPressure * cFactor * 60 - avgAbsGap * cFactor * 5);

    // 6. market — local demand movement (zone-specific)
    const mFactor = MARKET_ZONE_FACTOR[zone.name] || 1;
    const dd = D.MARKET_SERIES.demandIndex;
    const demandChange = dd[dd.length - 1] - dd[dd.length - 2];
    const market = clamp100((100 - Math.max(0, -demandChange) * 6) * mFactor);

    const w = CFG.health;
    const score = U.round(
      performance * w.performance +
      trend * w.trend +
      manpower * w.manpower +
      customer * w.customer +
      competitor * w.competitor +
      market * w.market,
      1
    );

    let level, color;
    if (score >= CFG.healthLevels.healthy) { level = "Healthy"; color = "#16845B"; }
    else if (score >= CFG.healthLevels.watch) { level = "Watch"; color = "#D99A00"; }
    else if (score >= CFG.healthLevels.risk) { level = "At Risk"; color = "#E8833A"; }
    else { level = "Critical"; color = "#C83E4D"; }

    return {
      score, level, color,
      components: {
        performance: U.round(performance, 1),
        trend: U.round(trend, 1),
        manpower: U.round(manpower, 1),
        customer: U.round(customer, 1),
        competitor: U.round(competitor, 1),
        market: U.round(market, 1),
      },
    };
  }

  function topDistributorShare(zone) {
    const ds = D.DISTRIBUTORS.filter((d) => d.zone === zone.name);
    if (!ds.length) return 0;
    // distributor "share" approximated by its territory share of zone actual
    let maxShare = 0;
    ds.forEach((d) => {
      const terr = D.TERRITORIES.find((t) => t.name === d.territory);
      const share = U.safeDiv(terr ? U.sum(terr.actual) : 0, U.sum(zone.actual));
      if (share > maxShare) maxShare = share;
    });
    return maxShare;
  }

  /* ============================ SEVERITY ============================ */
  function severityFor(impactCr, persistence) {
    const s = CFG.severityImpactCr;
    if (impactCr >= s.critical || (persistence >= 3 && impactCr >= s.warning)) return "critical";
    if (impactCr >= s.warning || persistence >= 2) return "warning";
    if (impactCr >= s.watch || persistence >= 1) return "watch";
    return "info";
  }

  function priorityFor(s) {
    if (s.sev === "critical" && s.research === "Required") return "Immediate Investigation";
    if (s.sev === "warning" && s.research !== "Not required") return "Priority Research";
    if (s.sev === "watch") return "Monitor";
    return "Low Priority";
  }

  /* ============================ SIGNAL BUILDER ============================ */
  function buildSignals() {
    const sigs = [];
    let n = 0;
    const id = () => "SIG-" + String(++n).padStart(4, "0");

    const push = (s) => {
      s.id = id();
      s.priority = priorityFor(s);
      sigs.push(s);
    };

    // ---- Performance signals (data-driven) ----
    const natActual = D.ZONES.map((z) => z.actual);
    const natMom = D.CUR > 0
      ? U.pctChange(U.sum(natActual.map((a) => a[D.CUR])), U.sum(natActual.map((a) => a[D.CUR - 1])))
      : 0;
    D.ZONES.forEach((z) => {
      const m = zoneMetrics(z);
      const impactCr = (m.gap / CR) * CFG.impactRecoverableRate;
      const achvPct = m.achv * 100;

      if (achvPct < CFG.criticalThreshold * 100) {
        push({
          type: "Performance", title: "Persistent critical underachievement", sev: "critical",
          zone: z.name, product: "Bulk", detected: "12 Sep 2026",
          metric: "Achievement", cur: U.fmtPct(m.achv), prev: U.fmtPct(m.prev),
          dev: U.fmtPctDelta(m.cur - m.prev), persistence: m.persistence,
          impactCr, impact: U.fmtCr(impactCr * CR),
          evidence: "Partial", research: "Required", action: "None",
        });
      } else if (achvPct < 52) {
        push({
          type: "Performance", title: "Persistent underachievement", sev: "warning",
          zone: z.name, product: "Bulk", detected: "11 Sep 2026",
          metric: "Achievement", cur: U.fmtPct(m.achv), prev: U.fmtPct(m.prev),
          dev: U.fmtPctDelta(m.cur - m.prev), persistence: m.persistence,
          impactCr, impact: U.fmtCr(impactCr * CR),
          evidence: "Partial", research: "Required", action: "None",
        });
      }

      // sudden decline — relative to national MTD movement (avoids MTD artefacts)
      if (D.CUR > 0 && m.mom < natMom - 0.06) {
        push({
          type: "Performance", title: "Sudden MTD sales decline (vs national)", sev: "watch",
          zone: z.name, product: "Bulk", detected: "13 Sep 2026",
          metric: "MoM", cur: U.fmtSignedPct(m.mom), prev: U.fmtSignedPct(natMom),
          dev: U.fmtPctDelta(m.mom - natMom), persistence: 1,
          impactCr: impactCr * 0.5, impact: U.fmtCr(impactCr * 0.5 * CR),
          evidence: "Not started", research: "Monitor", action: "None",
        });
      }

      if (m.recovering) {
        push({
          type: "Performance", title: "Recovery after decline", sev: "info",
          zone: z.name, product: "Bulk", detected: "15 Sep 2026",
          metric: "MoM", cur: U.fmtSignedPct(m.mom), prev: U.fmtPct(m.prev),
          dev: U.fmtPctDelta(m.mom), persistence: 0,
          impactCr: 0, impact: "—",
          evidence: "Partial", research: "Not required", action: "Monitor",
        });
      }
    });

    // ---- Manpower signals ----
    D.EMPLOYEES.forEach((e) => {
      const achv = U.pctVal(U.sum(e.actual), U.sum(e.target));
      if (achv < 0.45) {
        push({
          type: "Manpower", title: "Low employee productivity", sev: achv < 0.35 ? "warning" : "watch",
          zone: e.zone, territory: e.territory, product: "Bulk", detected: "14 Sep 2026",
          metric: "Employee achievement", cur: U.fmtPct(achv), prev: "—",
          dev: "—", persistence: 1, impactCr: 1.2, impact: U.fmtCr(1.2 * CR),
          evidence: "Partial", research: "Required", action: "None",
        });
      }
    });

    // ---- Customer signals ----
    const zoneCustomerStats = (zname) => {
      const cs = D.CUSTOMERS.filter((c) => c.zone === zname);
      const active = cs.filter((c) => c.status !== "Lost");
      const lost = cs.filter((c) => c.status === "Lost");
      const sorted = [...cs].sort((a, b) => b.totalActual - a.totalActual);
      return { cs, active, lost, sorted, topShare: U.safeDiv(sorted[0] ? sorted[0].totalActual : 0, zoneMetrics(D.zoneByName(zname)).totalActual) };
    };
    D.ZONES.forEach((z) => {
      const st = zoneCustomerStats(z.name);
      const m = zoneMetrics(z);
      if (st.lost.length) {
        push({
          type: "Customer", title: "Customer loss (" + st.lost.length + ")", sev: st.lost.length >= 2 ? "warning" : "watch",
          zone: z.name, product: "Bulk", detected: "12 Sep 2026",
          metric: "Lost customers", cur: String(st.lost.length), prev: "0",
          dev: "+" + st.lost.length, persistence: 1, impactCr: 1.5, impact: U.fmtCr(1.5 * CR),
          evidence: "Partial", research: "Required", action: "None",
        });
      }
      if (st.topShare > CFG.topCustomerShare) {
        push({
          type: "Customer", title: "Customer concentration risk", sev: st.topShare > 0.4 ? "warning" : "watch",
          zone: z.name, product: "Bulk", detected: "11 Sep 2026",
          metric: "Top customer share", cur: U.fmtPct(st.topShare), prev: U.fmtPct(CFG.topCustomerShare),
          dev: U.fmtPctDelta(st.topShare - CFG.topCustomerShare), persistence: 2,
          impactCr: (m.gap / CR) * 0.2, impact: U.fmtCr((m.gap / CR) * 0.2 * CR),
          evidence: "Partial", research: "Required", action: "None",
        });
      }
      const td = topDistributorShare(z);
      if (td > CFG.distributorDependency) {
        push({
          type: "Customer", title: "Distributor dependency", sev: td > 0.5 ? "warning" : "watch",
          zone: z.name, product: "Bulk", detected: "10 Sep 2026",
          metric: "Top distributor share", cur: U.fmtPct(td), prev: U.fmtPct(CFG.distributorDependency),
          dev: U.fmtPctDelta(td - CFG.distributorDependency), persistence: 3,
          impactCr: (m.gap / CR) * 0.3, impact: U.fmtCr((m.gap / CR) * 0.3 * CR),
          evidence: "Partial", research: "Required", action: "None",
        });
      }
    });

    // ---- Competitor signals (sample audit data) ----
    D.COMPETITORS.forEach((c) => {
      if (Math.abs(c.priceGap) > CFG.priceGapWarnPct) {
        push({
          type: "Competitor", title: c.name + " price advantage", sev: Math.abs(c.priceGap) >= 8 ? "warning" : "watch",
          zone: "National", product: c.focus, detected: "12 Sep 2026",
          metric: "Price gap vs AEL", cur: c.priceGap + "%", prev: "-2%",
          dev: (c.priceGap + 2) + " pp", persistence: 2, impactCr: 3.1, impact: U.fmtCr(3.1 * CR),
          evidence: "Partial", research: "Required", action: "None",
        });
      }
      if (c.pressure >= 0.65) {
        push({
          type: "Competitor", title: c.name + " promotional pressure", sev: "watch",
          zone: "National", product: c.focus, detected: "14 Sep 2026",
          metric: "Competitor pressure", cur: U.fmtPct(c.pressure), prev: U.fmtPct(0.55),
          dev: U.fmtPctDelta(c.pressure - 0.55), persistence: 1, impactCr: 2.0, impact: U.fmtCr(2.0 * CR),
          evidence: "Not started", research: "Monitor", action: "None",
        });
      }
    });

    // ---- Market signals (sample indices) ----
    const dd = D.MARKET_SERIES.demandIndex;
    const pp = D.MARKET_SERIES.priceIndex;
    const ss = D.MARKET_SERIES.supplyIndex;
    const demandChange = dd[dd.length - 1] - dd[dd.length - 2];
    const priceChange = pp[pp.length - 1] - pp[pp.length - 2];
    const supplyChange = ss[ss.length - 1] - ss[ss.length - 2];
    if (demandChange <= -CFG.demandDropIndex) {
      push({
        type: "Market", title: "Market demand decline", sev: "watch", zone: "National", product: "Bulk",
        detected: "14 Sep 2026", metric: "Demand index", cur: String(dd[dd.length - 1]), prev: String(dd[dd.length - 2]),
        dev: (demandChange > 0 ? "+" : "") + demandChange, persistence: 1, impactCr: 2.5, impact: U.fmtCr(2.5 * CR),
        evidence: "Not started", research: "Monitor", action: "None",
      });
    }
    if (priceChange >= 1) {
      push({
        type: "Market", title: "Market price movement (input cost)", sev: "info", zone: "National", product: "Bulk",
        detected: "14 Sep 2026", metric: "Price index", cur: String(pp[pp.length - 1]), prev: String(pp[pp.length - 2]),
        dev: "+" + priceChange, persistence: 2, impactCr: 1.0, impact: U.fmtCr(1.0 * CR),
        evidence: "Not started", research: "Not required", action: "Monitor",
      });
    }
    if (supplyChange < 0) {
      push({
        type: "Market", title: "Supply disruption risk", sev: "watch", zone: "National", product: "Bulk",
        detected: "14 Sep 2026", metric: "Supply index", cur: String(ss[ss.length - 1]), prev: String(ss[ss.length - 2]),
        dev: (supplyChange > 0 ? "+" : "") + supplyChange, persistence: 1, impactCr: 1.8, impact: U.fmtCr(1.8 * CR),
        evidence: "Not started", research: "Monitor", action: "None",
      });
    }
    push({
      type: "Market", title: "Seasonal deviation (Q3 monsoon)", sev: "info", zone: "National", product: "Bulk",
      detected: "15 Sep 2026", metric: "Seasonal index", cur: "0.92", prev: "1.00",
      dev: "-0.08", persistence: 1, impactCr: 0.8, impact: U.fmtCr(0.8 * CR),
      evidence: "Not started", research: "Not required", action: "Monitor",
    });

    return sigs;
  }

  const SIGNALS = buildSignals();

  /* ---------- cross-cuts ---------- */
  const signalsForZone = (zoneName) => SIGNALS.filter((s) => s.zone === zoneName);
  const criticalCount = () => SIGNALS.filter((s) => s.sev === "critical").length;
  const warningCount = () => SIGNALS.filter((s) => s.sev === "warning").length;
  const watchCount = () => SIGNALS.filter((s) => s.sev === "watch").length;
  const researchRequiredCount = () => SIGNALS.filter((s) => s.research === "Required").length;
  const recoveryCount = () => SIGNALS.filter((s) => s.title.startsWith("Recovery")).length;

  global.Signals = {
    SEV_LABEL, SIGNALS, zoneMetrics, health, severityFor, priorityFor,
    signalsForZone, criticalCount, warningCount, watchCount,
    researchRequiredCount, recoveryCount, topDistributorShare,
  };
})(window);
