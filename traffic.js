// Campus traffic demo: weekday-average TomTom speeds on 12 roads into the UARK campus.
// Data: data/traffic.json (built by tools/build_data.py), basemap from OpenStreetMap via data/basemap.json.
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const VIEW = [-1600, -1700, 3440, 2958];                 // metres around Old Main (x east, y south)
  const SHORT = {
    "Hwy 16 / Wedington (north)": "Hwy 16",
    "Hwy 180 / MLK Blvd": "MLK Blvd",
    "N College Ave": "College Ave",
    "N Garland Ave": "Garland Ave",
    "N Leverett Ave": "Leverett Ave",
    "N Razorback Rd": "N Razorback Rd",
    "Razorback Rd/Maple corridor, northbound (MLK->Garland)": "Razorback Rd ↑",
    "Razorback Rd/Maple corridor, southbound (Garland->MLK)": "Razorback Rd ↓",
    "W Center St (near planned Razorback Rd garage)": "Center St",
    "W Dickson St": "Dickson St",
    "W Maple St (Garland->College)": "Maple St",
    "W North St": "North St",
  };
  const FULL = {
    "Razorback Rd ↑": "Razorback Rd, northbound (MLK → Garland)",
    "Razorback Rd ↓": "Razorback Rd, southbound (Garland → MLK)",
    "Center St": "Center St (next to the planned Razorback Rd garage)",
  };
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const $ = id => document.getElementById(id);
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  const pathOf = (flat, close) => {
    let d = "";
    for (let i = 0; i < flat.length; i += 2) d += (i ? "L" : "M") + flat[i] + " " + flat[i + 1];
    return close ? d + "Z" : d;
  };
  const level = r => r >= 0.9 ? "free" : r >= 0.75 ? "light" : r >= 0.6 ? "slow" : "jam";
  const clockOf = i => {
    const slot = 12 + i, h = Math.floor(slot / 2), m = slot % 2 ? "30" : "00";
    return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? "am" : "pm"}`;
  };
  // shift a polyline sideways (metres) so two directions of one road don't sit on top of each other
  const offset = (pts, d) => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    return [p[0] - dy / len * d, p[1] + dx / len * d];
  });

  const state = { day: 1, slot: 21, sel: null, timer: null };
  let T, roadEls = [];

  Promise.all([fetch("data/basemap.json").then(r => r.json()), fetch("data/traffic.json").then(r => r.json())])
    .then(([B, traffic]) => { T = traffic; draw(B); pickStart(); render(); })
    .catch(() => { $("readout").textContent = "The traffic map couldn't load. Try refreshing the page."; });

  function draw(B) {
    const svg = $("map");
    svg.setAttribute("viewBox", VIEW.join(" "));
    const g = el("g", {}, svg);
    el("path", { d: B.green.map(p => pathOf(p, true)).join(""), fill: "var(--map-green)" }, g);
    const byK = {};
    B.ways.forEach(w => (byK[w.k] = byK[w.k] || []).push(pathOf(w.p)));
    const width = { 0: 34, 1: 30, 2: 24, 3: 17, 4: 10 };
    [4, 3, 2, 1, 0].forEach(k => byK[k] && el("path", { d: byK[k].join(""), fill: "none", stroke: "var(--map-road-edge)", "stroke-width": width[k] + 6, "stroke-linecap": "round", "stroke-linejoin": "round" }, g));
    [4, 3, 2, 1, 0].forEach(k => byK[k] && el("path", { d: byK[k].join(""), fill: "none", stroke: "var(--map-road)", "stroke-width": width[k], "stroke-linecap": "round", "stroke-linejoin": "round" }, g));
    el("path", { d: B.buildings.map(p => pathOf(p, true)).join(""), fill: "var(--map-bldg)" }, g);
    el("path", { d: B.lots.map(p => pathOf(p, true)).join(""), fill: "none", stroke: "var(--map-lot)", "stroke-width": 5, "stroke-dasharray": "14 10" }, g);

    const roads = el("g", {}, svg), labels = el("g", {}, svg);
    T.roads.forEach((r, i) => {
      const name = SHORT[r.label] || r.label;
      const dir = /northbound/.test(r.label) ? 16 : /southbound/.test(r.label) ? -16 : 0;
      const pts = dir ? offset(r.shape, dir) : r.shape;
      const d = pathOf(pts.flat());
      el("path", { d, class: "road-case", "stroke-width": 50 }, roads);
      const p = el("path", { d, class: "road", "stroke-width": 32, tabindex: 0, role: "button", "aria-label": name }, roads);
      p.addEventListener("pointermove", e => showTip(e, i));
      p.addEventListener("pointerleave", hideTip);
      p.addEventListener("click", () => { state.sel = i; render(); });
      p.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); state.sel = i; render(); } });
      roadEls.push(p);
      const mid = pts[Math.floor(pts.length * 0.55)];
      const nearRight = mid[0] > VIEW[0] + VIEW[2] - 750;   // keep labels inside the map
      const t = el("text", { x: mid[0] + (nearRight ? -44 : 44), y: mid[1] - 36, class: "lbl", "text-anchor": nearRight ? "end" : "start" }, labels);
      t.textContent = name;
    });
    el("circle", { cx: 0, cy: 0, r: 34, class: "om" }, labels);
    const om = el("text", { x: 52, y: 18, class: "om-lbl" }, labels);
    om.textContent = "Old Main";

    const days = $("days");
    DAYS.forEach((d, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = d.slice(0, 3);
      b.setAttribute("aria-label", d);
      b.addEventListener("click", () => { state.day = i; render(); });
      days.appendChild(b);
    });
    $("slot").addEventListener("input", e => { stop(); state.slot = +e.target.value; render(); });
    $("play").addEventListener("click", () => state.timer ? stop() : play());
    const n = T.readings.toLocaleString("en-US");
    const fmt = s => new Date(s + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    $("demo-meta").textContent = `Measured, not modeled: ${n} TomTom readings my logger recorded, ${fmt(T.first)} – ${fmt(T.last)}, ${new Date(T.last).getFullYear()}.`;
    const sr = $("stat-readings"); if (sr) sr.textContent = n;
    const ticks = document.createElement("div");
    ticks.className = "profile-sub"; ticks.style.cssText = "display:flex;justify-content:space-between;margin-top:2px";
    ["6 am", "9", "noon", "3 pm", "7:30"].forEach(s => { const sp = document.createElement("span"); sp.textContent = s; ticks.appendChild(sp); });
    $("profile").after(ticks);
  }

  // start on the weekday half hour where the network as a whole is slowest
  function pickStart() {
    let best = { v: 9 };
    for (let d = 0; d < 5; d++) for (let s = 0; s < 28; s++) {
      const vals = T.roads.map(r => r.grid[d][s]).filter(v => v != null);
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (avg < best.v) best = { v: avg, d, s };
    }
    state.day = best.d; state.slot = best.s;
  }

  function render() {
    const { day, slot } = state;
    $("slot").value = slot;
    $("clock").textContent = clockOf(slot);
    [...$("days").children].forEach((b, i) => b.setAttribute("aria-pressed", i === day));
    let worst = null;
    T.roads.forEach((r, i) => {
      const v = r.grid[day][slot];
      roadEls[i].style.stroke = v == null ? "var(--map-lot)" : `var(--t-${level(v)})`;
      roadEls[i].classList.toggle("is-sel", state.sel === i);
      if (v != null && (!worst || v < worst.v)) worst = { v, i };
    });
    const slowCount = T.roads.filter(r => (r.grid[day][slot] ?? 1) < 0.75).length;
    if (state.sel == null) state.sel = worst.i;
    const w = T.roads[worst.i], wn = SHORT[w.label];
    const mph = Math.round(w.freeFlow * worst.v / 1.609);
    $("readout").innerHTML = `<b>${DAYS[day]}s, ${clockOf(slot)}:</b> the slowest road is ${FULL[wn] || wn}, moving at <b>${Math.round(worst.v * 100)}%</b> of its normal speed (about ${mph} mph). ${slowCount} of 12 roads are below 75%.`;
    drawProfile();
  }

  function drawProfile() {
    const r = T.roads[state.sel], name = SHORT[r.label];
    $("profile-name").textContent = `${FULL[name] || name}, ${DAYS[state.day]}s`;
    const svg = $("profile"); svg.textContent = "";
    const W = 560, H = 120, lo = 0.3, hi = 1.05;
    const x = s => s / 27 * W, y = v => H - (v - lo) / (hi - lo) * H;
    el("line", { x1: 0, x2: W, y1: y(1), y2: y(1), stroke: "var(--line)", "stroke-dasharray": "4 4", "vector-effect": "non-scaling-stroke" }, svg);
    el("line", { x1: 0, x2: W, y1: y(0.6), y2: y(0.6), stroke: "var(--t-jam)", "stroke-opacity": 0.35, "stroke-dasharray": "2 4", "vector-effect": "non-scaling-stroke" }, svg);
    const vals = r.grid[state.day];
    let d = "", area = "";
    vals.forEach((v, s) => { if (v == null) return; d += (d ? "L" : "M") + x(s) + " " + y(v); });
    area = d + `L${W} ${H}L0 ${H}Z`;
    el("path", { d: area, fill: "var(--accent)", "fill-opacity": 0.08 }, svg);
    el("path", { d, fill: "none", stroke: "var(--accent)", "stroke-width": 2.5, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }, svg);
    const v = vals[state.slot];
    if (v != null) {
      el("line", { x1: x(state.slot), x2: x(state.slot), y1: 0, y2: H, stroke: "var(--ink)", "stroke-opacity": 0.25, "vector-effect": "non-scaling-stroke" }, svg);
      el("circle", { cx: x(state.slot), cy: y(v), r: 4, fill: `var(--t-${level(v)})`, stroke: "var(--surface)", "stroke-width": 2, "vector-effect": "non-scaling-stroke" }, svg);
    }
  }

  function showTip(e, i) {
    const r = T.roads[i], v = r.grid[state.day][state.slot], name = SHORT[r.label];
    const box = $("map").parentElement.getBoundingClientRect(), tip = $("tip");
    tip.innerHTML = `<strong>${FULL[name] || name}</strong><br>${v == null ? "No readings for this time" : `<b>${Math.round(v * 100)}%</b> of normal speed · about ${Math.round(r.freeFlow * v / 1.609)} mph (normally ${Math.round(r.freeFlow / 1.609)})`}`;
    tip.hidden = false;
    const left = Math.min(e.clientX - box.left + 14, box.width - 250);
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = Math.max(8, e.clientY - box.top - 60) + "px";
  }
  function hideTip() { $("tip").hidden = true; }

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function play() {
    if (state.slot >= 27) state.slot = 0;
    $("play-icon").setAttribute("d", "M7 5h4v14H7zM13 5h4v14h-4z");
    state.timer = setInterval(() => {
      if (state.slot >= 27) return stop();
      state.slot++; render();
    }, reduced ? 900 : 420);
  }
  function stop() {
    clearInterval(state.timer); state.timer = null;
    $("play-icon").setAttribute("d", "M8 5v14l11-7z");
  }
})();
