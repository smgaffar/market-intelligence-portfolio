/* =========================================================================
   data.js — DATA LAYER (separated from UI)
   -------------------------------------------------------------------------
   - CONFIG : every threshold / weight / business rule is configurable.
   - Real AEL Bulk sales data (Jul–Sep 2026) at Division level, sourced from
     "AEL Bulk Region-wise Sales vs Target Jul-Sep 2026".
   - Hierarchy below Division (Region → Territory → Employee/SR → Distributor
     → Customer) is deterministic SAMPLE / DEMO data, generated so it is stable
     and can be replaced later with Excel / CSV / API / DB without UI changes.
   ========================================================================= */
(function (global) {
  "use strict";
  const U = global.Utils;

  /* ============================ CONFIG ============================ */
  const CONFIG = {
    currency: "BDT",
    // performance thresholds (achievement fraction)
    perfThreshold: 0.60,       // below this = under-performing zone
    criticalThreshold: 0.45,   // below this = critical zone
    persistenceMonths: 2,      // consecutive months below threshold => persistent
    suddenDropPct: 0.08,       // MoM actual drop > this => "sudden decline"
    gapExpansionPct: 0.20,     // MoM gap growth > this => "gap expansion"
    recoveryPct: 0.05,         // MoM improvement > this => "recovery"
    volatilityThreshold: 0.08, // achievement stddev > this => "volatile"
    // customer / distributor concentration
    topCustomerShare: 0.12,    // top customer share of zone sales => concentration
    distributorDependency: 0.32,// top distributor share of zone sales => dependency
    activeDeclineMonths: 2,
    // competitor / market
    priceGapWarnPct: 3,        // |gap|% above this => competitor price advantage
    demandDropIndex: 2,        // market demand index drop points
    // health model weights (sum = 1)
    health: {
      performance: 0.35,       // achievement
      trend: 0.20,             // persistence + recovery + volatility
      manpower: 0.15,          // employee productivity
      customer: 0.12,          // active customer trend + concentration + dependency
      competitor: 0.10,        // competitor pressure + price gap
      market: 0.08,            // demand / price movement
    },
    healthLevels: { healthy: 62, watch: 50, risk: 45 }, // score >= healthy => Healthy, >= watch => Watch, >= risk => At Risk, else Critical
    // business impact estimation
    impactRecoverableRate: 0.55,   // portion of gap that is recoverable (estimated)
    impactOpportunityRate: 0.80,   // recovery opportunity vs gap
    severityImpactCr: { critical: 8, warning: 4, watch: 2 }, // estimated impact (Cr) to reach severity
    // SKU (C) suffix = "no target set" product
    noTargetMark: "(C)",
  };

  /* ============================ TIME ============================ */
  const MONTHS = [
    { key: "2026-07", label: "Jul 2026", short: "Jul", year: 2026, m: 6 },
    { key: "2026-08", label: "Aug 2026", short: "Aug", year: 2026, m: 7 },
    { key: "2026-09", label: "Sep 2026", short: "Sep", year: 2026, m: 8 },
  ];
  const CUR = MONTHS.length - 1; // current (MTD) month index
  const LAST_UPDATED = "16 Sep 2026";

  /* ============================ ZONES (real) ============================ */
  // AEL Bulk Divisions = "Zones". target/actual arrays index aligned to MONTHS.
  const ZONES = [
    { id: "ZN-DS", name: "Dhaka South",   region: "Dhaka",      lat: 23.71, lng: 90.41,
      target: [87843082, 91133708, 96008520], actual: [80122170, 79906903, 36759225] },
    { id: "ZN-DN", name: "Dhaka North",   region: "Dhaka",      lat: 23.90, lng: 90.41,
      target: [81290078, 85120812, 104109084], actual: [53566590, 58510893, 19198997] },
    { id: "ZN-CG", name: "Chittagong",    region: "Chittagong", lat: 22.35, lng: 91.78,
      target: [79449122, 81668180, 84809071], actual: [52690709, 60966340, 25467876] },
    { id: "ZN-KH", name: "Khulna",        region: "Khulna",     lat: 22.85, lng: 89.54,
      target: [72995457, 74642053, 75535709], actual: [48099942, 54460339, 24437196] },
    { id: "ZN-RJ", name: "Rajshahi",      region: "Rajshahi",   lat: 24.37, lng: 88.60,
      target: [30345823, 33558449, 26284303], actual: [12939487, 14885114, 7910672] },
    { id: "ZN-SY", name: "Sylhet",        region: "Sylhet",     lat: 24.89, lng: 91.87,
      target: [39154123, 40114944, 44564032], actual: [21778735, 24858414, 10483306] },
  ];

  /* ============================ PRODUCTS / SKUs (real) ============================ */
  const CATEGORIES = [
    { name: "Flour", bulk: true },
    { name: "Rice", bulk: true },
    { name: "Dal (Lentils & Pulses)", bulk: true },
  ];
  // Bulk SKU table (target/sales value in BDT, 3-month). (C) = no target set.
  const SKUS = [
    // Flour
    { sku: "FLR-001", category: "Flour", name: "Atta 1 kg",               pack: "1 kg",    target: 244116093, sales: 135953636 },
    { sku: "FLR-002", category: "Flour", name: "Atta 2 kg",               pack: "2 kg",    target: 69014592,  sales: 35435889 },
    { sku: "FLR-003", category: "Flour", name: "Atta 5 kg",               pack: "5 kg",    target: 68652938,  sales: 40049541 },
    { sku: "FLR-004", category: "Flour", name: "Atta 25 kg",              pack: "25 kg",   target: 2788125,   sales: 659725 },
    { sku: "FLR-005", category: "Flour", name: "Brown Atta 1 kg",         pack: "1 kg",    target: 41419260,  sales: 21778555 },
    { sku: "FLR-006", category: "Flour", name: "Brown Atta 2 kg",         pack: "2 kg",    target: 3233060,   sales: 2462908 },
    { sku: "FLR-007", category: "Flour", name: "Gram flour 500gm",        pack: "500 g",   target: 0,         sales: 7104 },
    { sku: "FLR-008", category: "Flour", name: "Maida 1 kg",              pack: "1 kg",    target: 45430522,  sales: 27844317 },
    { sku: "FLR-009", category: "Flour", name: "Maida 2 kg",              pack: "2 kg",    target: 6725630,   sales: 4149922 },
    { sku: "FLR-010", category: "Flour", name: "Maida 25 kg",             pack: "25 kg",   target: 8761225,   sales: 12892695 },
    { sku: "FLR-011", category: "Flour", name: "Suji 500 g",              pack: "500 g",   target: 31115200,  sales: 25201752 },
    { sku: "FLR-012", category: "Flour", name: "Suji 200 g",              pack: "200 g",   target: 5765131,   sales: 1817002 },
    // Rice
    { sku: "RIC-001", category: "Rice", name: "Chinigura Premium 1 kg",   pack: "1 kg",    target: 237022044, sales: 162718417 },
    { sku: "RIC-002", category: "Rice", name: "Chinigura Premium-New 25 kg", pack: "25 kg", target: 0,        sales: 2244750 },
    { sku: "RIC-003", category: "Rice", name: "Miniket 5 kg",             pack: "5 kg",    target: 14252700,  sales: 6664010 },
    { sku: "RIC-004", category: "Rice", name: "Essential Miniket 10 kg",  pack: "10 kg",   target: 9633360,   sales: 4038040 },
    { sku: "RIC-005", category: "Rice", name: "Miniket 25 kg",            pack: "25 kg",   target: 0,         sales: 2201500 },
    { sku: "RIC-006", category: "Rice", name: "Katari Najir 5 kg",        pack: "5 kg",    target: 19065290,  sales: 10078665 },
    { sku: "RIC-007", category: "Rice", name: "Katari Najir 10 kg",       pack: "10 kg",   target: 10995780,  sales: 4389600 },
    { sku: "RIC-008", category: "Rice", name: "Katari Najir 25 kg",       pack: "25 kg",   target: 0,         sales: 2112960 },
    { sku: "RIC-009", category: "Rice", name: "Premium Katari Ghee Bhog 5 kg", pack: "5 kg", target: 7717630, sales: 9945180 },
    { sku: "RIC-010", category: "Rice", name: "Katari Ghee Bhog 25 kg",   pack: "25 kg",   target: 0,         sales: 784875 },
    { sku: "RIC-011", category: "Rice", name: "Deshi Basmoti 5 Kg",       pack: "5 kg",    target: 7733000,   sales: 2736895 },
    { sku: "RIC-012", category: "Rice", name: "Deshi Basmoti 25 Kg",      pack: "25 kg",   target: 0,         sales: 38000 },
    { sku: "RIC-013", category: "Rice", name: "Premium Basmati 1 kg",     pack: "1 kg",    target: 7038850,   sales: 2837800 },
    { sku: "RIC-014", category: "Rice", name: "Paijam 25 kg",             pack: "25 kg",   target: 0,         sales: 1408950 },
    { sku: "RIC-015", category: "Rice", name: "Atash 25 Kg",              pack: "25 kg",   target: 0,         sales: 363375 },
    { sku: "RIC-016", category: "Rice", name: "Jirashail 25 kg",          pack: "25 kg",   target: 0,         sales: 16416 },
    { sku: "RIC-017", category: "Rice", name: "Katari Atop 25 kg",        pack: "25 kg",   target: 0,         sales: 810810 },
    // Dal
    { sku: "DAL-001", category: "Dal (Lentils & Pulses)", name: "Red Lentil 1 kg",      pack: "1 kg",  target: 15306760, sales: 5467899 },
    { sku: "DAL-002", category: "Dal (Lentils & Pulses)", name: "Lentil Medium 25 Kg",  pack: "25 kg", target: 16116100, sales: 4746025 },
    { sku: "DAL-003", category: "Dal (Lentils & Pulses)", name: "Lentil Small 25 Kg",   pack: "25 kg", target: 9392800,  sales: 777150 },
    { sku: "DAL-004", category: "Dal (Lentils & Pulses)", name: "Chickpeas Clean 1 Kg", pack: "1 kg",  target: 0,        sales: 12788 },
  ];
  SKUS.forEach((s) => {
    s.noTarget = s.target === 0;
    s.achv = s.target > 0 ? U.pctVal(s.sales, s.target) : null;
  });

  const PRODUCTS = CATEGORIES.map((c) => {
    const sk = SKUS.filter((s) => s.category === c.name);
    return {
      name: c.name,
      skus: sk,
      target: U.sum(sk.map((s) => s.target)),
      sales: U.sum(sk.map((s) => s.sales)),
    };
  });
  PRODUCTS.forEach((p) => { p.achv = U.pctVal(p.sales, p.target); });

  const CHANNELS = ["Wholesale", "Institutional", "Retail", "Semi-wholesale"];

  /* ============================ HIERARCHY (sample, deterministic) ============================ */
  const RNG = U.mulberry32(20260916);

  const regionDefs = {
    "Dhaka South": [["Dhaka South Metro", 0.52], ["Narayanganj", 0.48]],
    "Dhaka North": [["Dhaka North Metro", 0.62], ["Gazipur", 0.38]],
    "Chittagong":  [["Chattogram Metro", 0.55], ["Cumilla", 0.45]],
    "Khulna":      [["Khulna Metro", 0.50], ["Jashore", 0.50]],
    "Rajshahi":    [["Rajshahi Metro", 0.46], ["Bogura", 0.54]],
    "Sylhet":      [["Sylhet Metro", 0.65], ["Habiganj", 0.35]],
  };
  const ZONE_CHURN = { "Dhaka South": 0.05, "Dhaka North": 0.12, "Chittagong": 0.05, "Khulna": 0.05, "Rajshahi": 0.20, "Sylhet": 0.10 };

  const EMP_NAMES = ["Md. Samim Shorwar","Md. Alamin Hasan","Mohammad Masud","Md. Moaen Uddin","Md. Eusuf Ali","Ashraf Mia","Md. Shahin Alom","Md. Babul Hossain","Md. Rakibul Islam","Md. Jakir Hossain","Md. Sohel Rana","Md. Kamrul Hasan","Md. Imran Hossain","Md. Nasir Uddin","Md. Faruk Ahmed","Md. Rubel Mia","Md. Habibur Rahman","Md. Monir Hossain","Md. Saiful Islam","Md. Tanvir Ahmed","Md. Jahangir Alam","Md. Rezaul Karim","Md. Anwar Hossain","Md. Shamim Ahmed"];
  const CUST_NAMES = ["City Traders","Bangla Enterprise","Chattala Store","North Distribution","Khulna Traders","Sylhet Bazar","Rajshahi Mart","Padma Traders","Teesta Store","Jamuna Trading","Meghna Enterprise","Rupsha Traders","Surma Store","Karnafuli Traders","Dhaleshwari Bazar","Gumti Enterprise","Madhumati Traders","Brahmaputra Store","Karnaphuli Mart","Shitalakshya Traders","Atrai Bazar","Kushiyara Traders","Bangshi Enterprise","Ichamati Store"];
  const CUST_TYPES = ["Wholesaler", "Institutional", "Semi-wholesale", "Retailer"];

  const REGIONS = [], TERRITORIES = [], EMPLOYEES = [], DISTRIBUTORS = [], CUSTOMERS = [];

  // distribute a zone's monthly array to children by (share) and (share*eff, renormalized)
  function spread(arr, shares) { return arr.map((v, m) => v * shares[m]); }
  function spreadEff(arr, shares, eff) {
    const w = shares.map((s, i) => s * eff[i]);
    const wsum = U.sum(w) || 1;
    return arr.map((v, m) => v * w[m] / wsum);
  }

  let regionSeq = 1, terrSeq = 1, empSeq = 1, distSeq = 1, custSeq = 1;

  ZONES.forEach((zone) => {
    const rDefs = regionDefs[zone.name];
    const rShares = rDefs.map((d) => d[1]);

    rDefs.forEach((rd, ri) => {
      const regionName = rd[0];
      const region = {
        id: "RG-" + String(regionSeq++).padStart(3, "0"),
        name: regionName,
        zone: zone.name,
        region: zone.region,
        target: spread(zone.target, rShares).map((_, m) => zone.target[m] * rShares[ri]),
        actual: spread(zone.actual, rShares).map((_, m) => zone.actual[m] * rShares[ri]),
      };
      REGIONS.push(region);

      // 2 territories per region
      const tDefs = [["East", 0.55], ["West", 0.45]];
      tDefs.forEach((td, ti) => {
        const tShare = td[1];
        const territory = {
          id: "TR-" + String(terrSeq++).padStart(3, "0"),
          name: regionName + " " + td[0],
          zone: zone.name,
          region: region.name,
          target: region.target.map((v) => v * tShare),
          actual: region.actual.map((v) => v * tShare),
        };
        TERRITORIES.push(territory);

        // 2 employees per territory (efficiency variance for productivity signal)
        const empN = 2;
        const eShares = [0.55, 0.45];
        const eff = [0.62 + RNG() * 0.55, 0.62 + RNG() * 0.55];
        const empTarget = territory.target.map((v, m) => v * eShares[0]); // placeholder per emp
        // compute actual via efficiency
        const eActuals = [];
        for (let e = 0; e < empN; e++) {
          const actArr = territory.actual.map((v, m) => v * eShares[e] * eff[e] / (eShares[0] * eff[0] + eShares[1] * eff[1]));
          eActuals.push(actArr);
        }
        for (let e = 0; e < empN; e++) {
          const emp = {
            id: "EM-" + String(empSeq++).padStart(3, "0"),
            name: EMP_NAMES[(empSeq + e) % EMP_NAMES.length],
            zone: zone.name,
            region: region.name,
            territory: territory.name,
            target: territory.target.map((v, m) => v * eShares[e]),
            actual: eActuals[e],
            efficiency: eff[e],
          };
          EMPLOYEES.push(emp);
        }

        // 1 distributor per territory
        DISTRIBUTORS.push({
          id: "DI-" + String(distSeq++).padStart(3, "0"),
          name: "Akij Dist. " + territory.name,
          zone: zone.name,
          region: region.name,
          territory: territory.name,
          stockDays: Math.round(14 + RNG() * 40),       // inventory cover in days
          creditDays: Math.round(20 + RNG() * 25),
          coverage: Math.round(62 + RNG() * 35),         // % beat coverage
        });

        // 4 customers per territory
        const custShares = [0.38, 0.26, 0.20, 0.16];
        for (let c = 0; c < 4; c++) {
          const custEff = 0.55 + RNG() * 0.6;
          const churn = ZONE_CHURN[zone.name] || 0.06;
          const statusRoll = RNG();
          const status = statusRoll < churn ? "Lost" : (statusRoll < churn + 0.12 ? "New" : "Active");
          CUSTOMERS.push({
            id: "CU-" + String(custSeq++).padStart(3, "0"),
            name: "M/s " + CUST_NAMES[custSeq % CUST_NAMES.length],
            zone: zone.name,
            region: region.name,
            territory: territory.name,
            type: CUST_TYPES[Math.floor(RNG() * CUST_TYPES.length)],
            channel: CHANNELS[Math.floor(RNG() * CHANNELS.length)],
            target: territory.target.map((v, m) => v * custShares[c]),
            actual: territory.actual.map((v, m) => v * custShares[c] * custEff / (custShares.reduce((a, s) => a + s, 0) * 1)),
            share: custShares[c],
            freq: Math.round(4 + RNG() * 18),            // purchases / quarter
            skus: Math.round(3 + RNG() * 12),
            status,
            lastActivityDays: status === "Lost" ? Math.round(30 + RNG() * 60) : Math.round(0 + RNG() * 12),
          });
        }
      });
    });
  });

  // Normalise customer actual so territory actual matches (each customer scaled to share)
  CUSTOMERS.forEach((c) => {
    c.actual = c.actual.map((v) => v); // already computed; keep
    c.totalTarget = U.sum(c.target);
    c.totalActual = U.sum(c.actual);
  });
  // Recompute customer actuals cleanly as share of territory actual (sums exact)
  TERRITORIES.forEach((t) => {
    const cs = CUSTOMERS.filter((c) => c.territory === t.name);
    const ssum = U.sum(cs.map((c) => c.share));
    cs.forEach((c) => {
      c.actual = t.actual.map((v) => v * c.share / ssum);
      c.totalTarget = U.sum(c.target);
      c.totalActual = U.sum(c.actual);
    });
  });

  /* ============================ COMPETITORS (sample) ============================ */
  const COMPETITORS = [
    { id: "CP-01", name: "Bashundhara Food", focus: "Flour / Atta", priceGap: -4, avail: 82, dist: 71, promo: "High",   pressure: 0.76 },
    { id: "CP-02", name: "City Group",       focus: "Rice / Atta",  priceGap: -6, avail: 68, dist: 58, promo: "Medium", pressure: 0.58 },
    { id: "CP-03", name: "Square Food",      focus: "Atta / Maida", priceGap: -2, avail: 61, dist: 52, promo: "Medium", pressure: 0.44 },
    { id: "CP-04", name: "Pran",             focus: "Atta / Suji",  priceGap: -8, avail: 74, dist: 64, promo: "High",   pressure: 0.67 },
    { id: "CP-05", name: "Local Mills",      focus: "Bulk / Bran",  priceGap: -11,avail: 57, dist: 48, promo: "Low",    pressure: 0.39 },
  ];

  /* ============================ MARKET INDICES (sample) ============================ */
  const MARKET_SERIES = {
    demandIndex:   [100, 102, 101, 105, 107, 106, 109, 110, 112, 111, 108, 106],
    priceIndex:    [100, 101, 103, 104, 106, 108, 107, 108, 110, 112, 113, 114],
    aelVolumeIndex:[100, 96, 92, 90, 93, 95, 97, 99, 101, 98, 96, 95],
    supplyIndex:   [100, 100, 99, 98, 97, 98, 99, 100, 101, 99, 98, 97],
  };
  // align to 12 trailing months
  const MARKET_MONTHS = ["Oct 25","Nov 25","Dec 25","Jan 26","Feb 26","Mar 26","Apr 26","May 26","Jun 26","Jul 26","Aug 26","Sep 26"];

  /* ============================ RESEARCH / ACTIONS / MONITORING (sample) ============================ */
  const RESEARCH = [
    { id: "RCH-011", signal: "SIG-0001", question: "What is driving the Dhaka North MTD decline?",
      hypotheses: ["Customer loss", "Distributor stock issue", "Competitor price pressure", "Manpower coverage", "Product availability"],
      evidenceRequired: ["Sales trend", "Customer purchase history", "Distributor stock", "Competitor price audit", "SR coverage audit"],
      method: "Field research", owner: "R&I", deadline: "30 Sep 2026", status: "In Progress",
      finding: "", confidence: "Unvalidated", impact: "" },
    { id: "RCH-012", signal: "SIG-0002", question: "Why is Rajshahi achievement persistently low?",
      hypotheses: ["Coverage gap", "Manpower productivity", "Distributor dependency"],
      evidenceRequired: ["SR coverage audit", "Employee productivity", "Distributor interview"],
      method: "Coverage audit", owner: "R&I", deadline: "28 Sep 2026", status: "Open",
      finding: "", confidence: "Unvalidated", impact: "" },
    { id: "RCH-013", signal: "SIG-0003", question: "Is competitor pricing undercutting AEL in Sylhet?",
      hypotheses: ["Price gap vs Bashundhara", "Competitor availability increase"],
      evidenceRequired: ["Competitor price audit", "Retailer feedback", "Availability check"],
      method: "Price audit", owner: "CI", deadline: "05 Oct 2026", status: "Open",
      finding: "", confidence: "Unvalidated", impact: "" },
    { id: "RCH-014", signal: "SIG-0004", question: "Is customer concentration rising in Khulna?",
      hypotheses: ["Top customer dependency", "Institutional buying shift"],
      evidenceRequired: ["Customer purchase history", "Customer feedback"],
      method: "Customer analysis", owner: "R&I", deadline: "10 Oct 2026", status: "Open",
      finding: "", confidence: "Unvalidated", impact: "" },
  ];

  const ACTIONS = [
    { id: "ACT-001", issue: "Rajshahi route-to-market gap", action: "Restructure distributor + add SR", owner: "Sales Head", deadline: "15 Oct 2026", impact: "+8 pp", status: "In Progress" },
    { id: "ACT-002", issue: "Dhaka North coverage decline", action: "Redeploy 2 SR + beat redesign", owner: "ZSM Dhaka", deadline: "20 Sep 2026", impact: "+6 pp", status: "Overdue" },
    { id: "ACT-003", issue: "Dal category underperformance", action: "Category pricing & promotion review", owner: "Marketing", deadline: "30 Sep 2026", impact: "+12 pp", status: "Open" },
    { id: "ACT-004", issue: "Sylhet competitor price pressure", action: "Trade scheme vs Bashundhara", owner: "ZSM Sylhet", deadline: "08 Oct 2026", impact: "+5 pp", status: "In Progress" },
    { id: "ACT-005", issue: "Khulna distributor stock build-up", action: "Stock liquidation plan", owner: "Logistics", deadline: "25 Sep 2026", impact: "+4 pp", status: "Completed" },
  ];

  const MONITORING = [
    { zone: "Khulna", before: 54, after: 63, action: "Distributor restructuring", status: "Improved" },
    { zone: "Chittagong", before: 61, after: 64, action: "Added SR coverage", status: "Improved" },
    { zone: "Sylhet", before: 49, after: 51, action: "Promotion support", status: "Monitoring" },
    { zone: "Rajshahi", before: 41, after: 42, action: "Coverage audit", status: "No change" },
  ];

  const DATA_QUALITY = [
    { check: "Total records", count: 18432, rate: null, status: "info" },
    { check: "Valid records", count: 17910, rate: 0.972, status: "pos" },
    { check: "Missing records", count: 412, rate: 0.022, status: "warn" },
    { check: "Duplicate records", count: 78, rate: 0.004, status: "warn" },
    { check: "Invalid values", count: 32, rate: 0.002, status: "warn" },
    { check: "Missing target mapping", count: 61, rate: 0.003, status: "neg" },
    { check: "Missing employee mapping", count: 24, rate: 0.001, status: "neg" },
    { check: "Missing geography mapping", count: 18, rate: 0.001, status: "neg" },
  ];

  /* ============================ ACCESSORS ============================ */
  const zoneByName = (n) => ZONES.find((z) => z.name === n);
  const regionsOf = (zoneName) => REGIONS.filter((r) => r.zone === zoneName);
  const territoriesOf = (regionName) => TERRITORIES.filter((t) => t.region === regionName);
  const employeesOfTerritory = (terrName) => EMPLOYEES.filter((e) => e.territory === terrName);
  const customersOfTerritory = (terrName) => CUSTOMERS.filter((c) => c.territory === terrName);

  function childRows(parentLevel, parentKey, parentValue) {
    // generic drill-down row helper by level
    if (parentLevel === "zone") return regionsOf(parentValue);
    if (parentLevel === "region") return territoriesOf(parentValue);
    if (parentLevel === "territory") return employeesOfTerritory(parentValue).concat(distributorsOfTerritory(parentValue));
    return [];
  }
  function distributorsOfTerritory(terrName) { return DISTRIBUTORS.filter((d) => d.territory === terrName); }
  function distributorOfTerritory(terrName) { return DISTRIBUTORS.find((d) => d.territory === terrName); }

  const nationalTarget = () => ZONES.map((z) => U.sum(z.target));
  const nationalActual = () => ZONES.map((z) => U.sum(z.actual));

  global.Data = {
    CONFIG, MONTHS, CUR, LAST_UPDATED,
    ZONES, CATEGORIES, PRODUCTS, SKUS, CHANNELS,
    REGIONS, TERRITORIES, EMPLOYEES, DISTRIBUTORS, CUSTOMERS,
    COMPETITORS, MARKET_SERIES, MARKET_MONTHS,
    RESEARCH, ACTIONS, MONITORING, DATA_QUALITY,
    zoneByName, regionsOf, territoriesOf, employeesOfTerritory, customersOfTerritory,
    distributorOfTerritory, distributorsOfTerritory,
    nationalTarget, nationalActual, childRows,
  };
})(window);
