const fs = require("fs");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(__dirname + "/index.html", "utf8");

const z = n => String(n).padStart(2, "0");
const fmt = d => d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = new Date();
const TK = fmt(today);

let fails = 0, passes = 0;
const ok = (name, cond, extra) => {
  if (cond) { passes++; console.log("  PASS  " + name); }
  else { fails++; console.log("  FAIL  " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

function boot(seed) {
  const errs = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://x.test/",
    pretendToBeVisual: true,
    beforeParse(w) {
      if (seed) for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, JSON.stringify(v));
      w.addEventListener("error", e => errs.push(String(e.error || e.message)));
      w.scrollTo = () => {};
    }
  });
  dom.window.__errs = errs;
  return dom;
}
const $ = (d, s) => d.window.document.querySelector(s);
const $$ = (d, s) => [...d.window.document.querySelectorAll(s)];

// ---------------------------------------------------------------- 1. clean boot
console.log("\n[1] clean boot, no data");
{
  const d = boot(null);
  ok("no runtime errors", d.window.__errs.length === 0, d.window.__errs);
  ok("5 category rows rendered", $$(d, "#catLevels .lvrow").length === 5);
  ok("3 level buttons per row", $$(d, "#catLevels .lvrow")[0].querySelectorAll(".lvbtn").length === 3);
  ok("level buttons are Full/Floor/None",
    [...$$(d, "#catLevels .lvrow")[0].querySelectorAll(".lvbtn")].map(b => b.textContent).join(",") === "Full,Floor,None");
  ok("no old tier selector present", $(d, "#tiers") === null && $(d, ".tiers") === null);
  ok("no photo/camera UI", $(d, ".cam") === null && $(d, ".thumb") === null && !html.includes("indexedDB"));
  ok("no 'Maint' anywhere in output", !d.window.document.body.innerHTML.includes("Maint"));
  ok("heatmap has 56 cells", $$(d, "#heat .cell").length === 56);
  ok("log empty state shown", $(d, "#logList").textContent.includes("Nothing logged yet"));
  ok("daySum prompts for input", $(d, "#daySum").textContent.includes("Nothing set yet"));
  ok("tomorrow pills = Full/Floor", $$(d, "#tomorrowPills .pill").map(b => b.textContent).join(",") === "Full,Floor");
}

// ---------------------------------------------------------------- 2. heatmap order
console.log("\n[2] heatmap: week one at top, newer weeks below");
{
  // fresh start: min 8 rows, today sits in row 0
  const d = boot(null);
  let cells = $$(d, "#heat .cell");
  ok("minimum 8 rows on day one", cells.length === 56, cells.length);
  let idx = cells.findIndex(c => c.classList.contains("today"));
  ok("day-one week is the top row", Math.floor(idx / 7) === 0, { idx });
  ok("row order runs OLD -> NEW downward",
    (new Date(cells[7].title.slice(0, 10)) - new Date(cells[0].title.slice(0, 10))) / 864e5 === 7,
    { r0: cells[0].title, r1: cells[7].title });

  // started 20 weeks ago: week 1 at top, today in the LAST row
  const start = fmt(addDays(today, -20 * 7));
  const d2 = boot({ "floor.settings": { start } });
  cells = $$(d2, "#heat .cell");
  const rows = cells.length / 7;
  ok("grid grew to 21 rows (20 weeks back + this week)", rows === 21, rows);
  const startSun = addDays(new Date(start + "T00:00:00"), -new Date(start + "T00:00:00").getDay());
  ok("top-left cell is the Sunday of week one", cells[0].title.slice(0, 10) === fmt(startSun),
    { got: cells[0].title.slice(0, 10), want: fmt(startSun) });
  idx = cells.findIndex(c => c.classList.contains("today"));
  ok("today is in the BOTTOM row", Math.floor(idx / 7) === rows - 1, { idx, rows });
  ok("today column == weekday index", idx % 7 === today.getDay(), { col: idx % 7, dow: today.getDay() });
  const uniq = new Set(cells.map(c => c.title.slice(0, 10)));
  ok("all days unique and consecutive, no gaps", uniq.size === cells.length &&
    (new Date(cells[cells.length - 1].title.slice(0, 10)) - new Date(cells[0].title.slice(0, 10))) / 864e5 === cells.length - 1);
  ok("label reflects week count", $(d2, "#heatLabel").textContent.includes("Week 1 at the top"),
    $(d2, "#heatLabel").textContent);
  ok("weekday header row present", $$(d2, ".heatdow span").length === 7);
}

// ---------------------------------------------------------------- 2b. colour scale
console.log("\n[2b] black / grey / white level scale, consistent everywhere");
{
  const css = fs.readFileSync(__dirname + "/index.html", "utf8").split("</style>")[0];
  ok("light-mode full is black", /--full:#111111/.test(css));
  ok("light-mode floor is grey", /--floorc:#9a9a9a/.test(css));
  ok("light-mode none is white", /--nonec:#ffffff/.test(css));
  ok("no leftover var(--none) colour refs", !/var\(--none\)/.test(css));
  const rules = sel => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{[^}]*\\}", "g")) || []).join("");
  // every place a level is drawn must pull from the same three variables
  ["  .lvbtn.sel.full", "  .cell.full", "  .logdot.full", "  .logbody .lvtag.full"].forEach(s =>
    ok(s.trim() + " uses --full", rules(s).includes("var(--full)"), rules(s)));
  ["  .lvbtn.sel.floor", "  .cell.floor", "  .logdot.floor", "  .logbody .lvtag.floor"].forEach(s =>
    ok(s.trim() + " uses --floorc", rules(s).includes("var(--floorc)"), rules(s)));
  ["  .lvbtn.sel.none", "  .cell.none", "  .logdot.none", "  .logbody .lvtag.none"].forEach(s =>
    ok(s.trim() + " uses --nonec", rules(s).includes("var(--nonec)"), rules(s)));

  // rendered check
  const k = fmt(addDays(today, -1));
  const d = boot({
    "floor.days": { [k]: { lv: { train: "full", deep: "floor", cuff: "none" } } },
    "floor.settings": { start: fmt(addDays(today, -30)) }
  });
  const cell = $$(d, "#heat .cell").find(c => c.title.startsWith(k));
  ok("heat cell classed by derived tier", cell.classList.contains("floor"), cell.className);
  $(d, "#tabLog").click();
  const tags = [...$$(d, "#logList .logrow")[0].querySelectorAll(".lvtag")];
  ok("log tags carry level classes only", tags.length === 0 ||
    tags.every(t => ["full", "floor", "none"].some(x => t.classList.contains(x))));
}

// ---------------------------------------------------------------- 2c. multi-colored day swatch
console.log("\n[2c] day swatch is multi-colored (one stripe per category)");
{
  const d = boot(null);
  const rows = $$(d, "#catLevels .lvrow");
  rows[0].querySelectorAll(".lvbtn")[0].click();   // Trained -> Full
  rows[1].querySelectorAll(".lvbtn")[1].click();   // Deep     -> Floor
  rows[2].querySelectorAll(".lvbtn")[2].click();   // Articulate -> None
  const sw = $(d, "#daySum .daysw");
  ok("swatch exists", !!sw);
  const stripes = [...sw.querySelectorAll("i")].map(i => i.className);
  ok("5 stripes, one per category", stripes.length === 5, stripes);
  ok("stripes mirror each category's level",
    stripes[0] === "full" && stripes[1] === "floor" && stripes[2] === "none" &&
    stripes[3] === "unset" && stripes[4] === "unset", stripes);
}

// ---------------------------------------------------------------- 3. migration from old format
console.log("\n[3] migration from old single-tier data");
{
  const k1 = fmt(addDays(today, -1));   // old "full" day, all 5 checked
  const k2 = fmt(addDays(today, -2));   // old "maintenance" day, 2 checked
  const k3 = fmt(addDays(today, -3));   // old "zero" day
  const k4 = fmt(addDays(today, -4));   // old "floor" day, 1 checked
  const seed = {
    "floor.days": {
      [k1]: { tier: "full", train: true, deep: true, cuff: true, read: true, breath: true, journal: "Said no to the crypto pitch because I have no edge there.", det: { train: "FB-A 5x5 @185" }, pf: { train: true } },
      [k2]: { tier: "maintenance", train: true, read: true, det: { read: "Xunzi 12-24" } },
      [k3]: { tier: "zero" },
      [k4]: { tier: "floor", breath: true, next: "maintenance" },
    },
    "floor.settings": { start: fmt(addDays(today, -40)) },
    "floor.park": []
  };
  const d = boot(seed);
  ok("no runtime errors", d.window.__errs.length === 0, d.window.__errs);
  const days = JSON.parse(d.window.localStorage.getItem("floor.days"));
  ok("old full+5checks -> all five full", CATSok(days[k1], ["full", "full", "full", "full", "full"]), days[k1].lv);
  ok("old maintenance -> floor on checked, none on rest", CATSok(days[k2], ["floor", "none", "none", "floor", "none"]), days[k2].lv);
  ok("old zero -> all none", CATSok(days[k3], ["none", "none", "none", "none", "none"]), days[k3].lv);
  ok("old floor+1check -> floor on breath", CATSok(days[k4], ["none", "none", "none", "none", "floor"]), days[k4].lv);
  ok("photo field stripped", days[k1].pf === undefined);
  ok("next:maintenance migrated to floor", days[k4].next === "floor", days[k4].next);
  ok("detail text preserved", days[k1].det.train === "FB-A 5x5 @185" && days[k2].det.read === "Xunzi 12-24");
  ok("journal preserved", days[k1].journal.startsWith("Said no"));

  // derived day tiers land on the right shade
  const cells = $$(d, "#heat .cell");
  const byDate = {}; cells.forEach(c => byDate[c.title.slice(0, 10)] = c);
  ok("k1 heat cell = full", byDate[k1].classList.contains("full"));
  ok("k2 heat cell = floor", byDate[k2].classList.contains("floor"));
  ok("k3 heat cell = none", byDate[k3].classList.contains("none"));
  ok("k4 heat cell = floor", byDate[k4].classList.contains("floor"));
  ok("streak counts 2 non-zero days back from yesterday",
    $(d, "#streak").textContent.replace(/\s+/g, " ").includes("2 non-zero"), $(d, "#streak").textContent);
  ok("banner does not say 'maintenance'", !$(d, "#banners").textContent.toLowerCase().includes("maintenance"));
}
function CATSok(day, expected) {
  const ids = ["train", "deep", "cuff", "read", "breath"];
  return day && day.lv && ids.every((id, i) => day.lv[id] === expected[i]);
}

// ---------------------------------------------------------------- 4. day-tier rule
console.log("\n[4] derived day tier rule (3+ full = Full)");
{
  const mk = lv => ({ "floor.days": { [fmt(addDays(today, -1))]: { lv } }, "floor.settings": { start: fmt(addDays(today, -30)) } });
  const shade = seed => {
    const d = boot(seed);
    const c = $$(d, "#heat .cell").find(c => c.title.startsWith(fmt(addDays(today, -1))));
    return ["full", "floor", "none"].find(x => c.classList.contains(x)) || null;
  };
  ok("3 full + 2 none -> Full", shade(mk({ train: "full", deep: "full", cuff: "full", read: "none", breath: "none" })) === "full");
  ok("2 full + 3 floor -> Floor", shade(mk({ train: "full", deep: "full", cuff: "floor", read: "floor", breath: "floor" })) === "floor");
  ok("1 floor only -> Floor", shade(mk({ train: "floor" })) === "floor");
  ok("all none -> None", shade(mk({ train: "none", deep: "none", cuff: "none", read: "none", breath: "none" })) === "none");
  ok("nothing set -> unlogged", shade({ "floor.days": { [fmt(addDays(today, -1))]: {} } }) === null);
}

// ---------------------------------------------------------------- 5. interaction
console.log("\n[5] clicking levels writes per-category data");
{
  const d = boot(null);
  const rows = $$(d, "#catLevels .lvrow");
  rows[0].querySelectorAll(".lvbtn")[0].click();   // Trained -> Full
  rows[1].querySelectorAll(".lvbtn")[1].click();   // Deep work -> Floor
  rows[2].querySelectorAll(".lvbtn")[2].click();   // Articulate -> None
  const days = JSON.parse(d.window.localStorage.getItem("floor.days"));
  ok("Trained=full, Deep=floor, Articulate=none",
    days[TK].lv.train === "full" && days[TK].lv.deep === "floor" && days[TK].lv.cuff === "none", days[TK].lv);
  ok("detail input appears for full/floor only",
    $$(d, "#catLevels .lvrow")[0].querySelector(".lvdet") &&
    $$(d, "#catLevels .lvrow")[1].querySelector(".lvdet") &&
    !$$(d, "#catLevels .lvrow")[2].querySelector(".lvdet"));
  ok("selected button has .sel", $$(d, "#catLevels .lvrow")[0].querySelectorAll(".lvbtn")[0].classList.contains("sel"));
  ok("day summary updates", /Day reads as/.test($(d, "#daySum").textContent), $(d, "#daySum").textContent);
  // toggle off
  $$(d, "#catLevels .lvrow")[0].querySelectorAll(".lvbtn")[0].click();
  const days2 = JSON.parse(d.window.localStorage.getItem("floor.days"));
  ok("re-click clears the level", days2[TK].lv.train === undefined, days2[TK].lv);
  // detail typing
  $$(d, "#catLevels .lvrow")[1].querySelectorAll(".lvbtn")[1].click(); // keep deep=floor? it was already floor -> toggles off
  $$(d, "#catLevels .lvrow")[1].querySelectorAll(".lvbtn")[0].click(); // deep -> full
  const inp = $$(d, "#catLevels .lvrow")[1].querySelector(".lvdet input");
  inp.value = "70 min on LMT segment margins";
  inp.dispatchEvent(new d.window.Event("input"));
  ok("detail input wired", inp.value === "70 min on LMT segment margins");
}

// ---------------------------------------------------------------- 6. log page
console.log("\n[6] log page");
{
  const k1 = fmt(addDays(today, -1)), k2 = fmt(addDays(today, -9));
  const seed = {
    "floor.days": {
      [k1]: { lv: { train: "full", deep: "full", cuff: "full", read: "floor", breath: "none" },
              det: { train: "FB-A front squat 5x5 @185", deep: "LMT 10-K segment margins", cuff: "2-min memo on HON", read: "Xunzi ch.1" },
              journal: "Passed on the second internship posting because it splits the thread.", next: "full" },
      [k2]: { lv: { read: "floor" }, det: { read: "10 pages of Meditations" }, ship: "Wrote the 500-word HON note." },
    },
    "floor.settings": { start: fmt(addDays(today, -40)) }
  };
  const d = boot(seed);
  ok("no runtime errors", d.window.__errs.length === 0, d.window.__errs);
  ok("two tabs present", $$(d, ".tabs .tab").length === 2);
  ok("tracker visible by default", $(d, "#viewTrack").style.display !== "none" && $(d, "#viewLog").style.display === "none");
  $(d, "#tabLog").click();
  ok("log view shows after tab click", $(d, "#viewLog").style.display === "block" && $(d, "#viewTrack").style.display === "none");
  const rows = $$(d, "#logList .logrow");
  ok("2 log rows", rows.length === 2, rows.length);
  ok("newest row first", rows[0].querySelector(".logdate").textContent.includes(
    new Date(k1 + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })));
  const sum = rows[0].querySelector(".logsum").textContent;
  ok("compressed row shows tier + categories + journal snippet",
    sum.startsWith("Full") && sum.includes("Trained") && sum.includes("Passed on the second"), sum);
  ok("body hidden before click", rows[0].querySelector(".logbody") === null);
  rows[0].querySelector(".loghead").click();
  const body = $$(d, "#logList .logrow")[0].querySelector(".logbody");
  ok("body appears after click", !!body);
  ok("body shows what he wrote", body.textContent.includes("front squat 5x5 @185") &&
      body.textContent.includes("LMT 10-K segment margins") &&
      body.textContent.includes("Passed on the second internship posting"), body && body.textContent.slice(0, 200));
  ok("body shows per-category level tags", body.querySelectorAll(".lvtag").length === 5);
  ok("None category rendered too", [...body.querySelectorAll(".lvtag")].some(t => t.textContent === "None"));
  ok("ship note appears on the other row", (() => {
    $$(d, "#logList .logrow")[1].querySelector(".loghead").click();
    return $$(d, "#logList .logrow")[1].querySelector(".logbody").textContent.includes("500-word HON note");
  })());
  // edit link jumps back
  $$(d, "#logList .logrow")[0].querySelector(".logedit").click();
  ok("'open in tracker' switches view and day",
    $(d, "#viewTrack").style.display === "block" && $(d, "#todayLabel").textContent.includes(
      new Date(k1 + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" })),
    $(d, "#todayLabel").textContent);
  ok("month header rendered", $$(d, "#logList .logmonth").length >= 1);
}

// ---------------------------------------------------------------- 7. backfill + XSS
console.log("\n[7] backfill nav + escaping");
{
  const d = boot({ "floor.days": { [fmt(addDays(today, -1))]: { lv: { train: "full" }, det: { train: "<script>x</script>" }, journal: "<b>bold</b>" } } });
  $(d, "#prevDay").click();
  ok("prev day navigates", $(d, "#backfillTag").textContent === "backfill");
  ok("levels load for backfilled day", $$(d, "#catLevels .lvrow")[0].querySelectorAll(".lvbtn")[0].classList.contains("sel"));
  $(d, "#tabLog").click();
  $$(d, "#logList .logrow")[0].querySelector(".loghead").click();
  const body = $$(d, "#logList .logrow")[0].querySelector(".logbody");
  ok("html in user text is escaped", body.querySelector("script") === null && body.querySelector("b") === null,
    body.innerHTML.slice(0, 200));
}

// ---------------------------------------------------------------- 8. insights with 30 days
console.log("\n[8] insights engine on 30 seeded days");
{
  const dd = {};
  for (let i = 1; i <= 30; i++) {
    const k = fmt(addDays(today, -i));
    const lv = i % 5 === 0
      ? { train: "none", deep: "none", cuff: "none", read: "none", breath: "none" }
      : { train: "full", deep: i % 2 ? "full" : "floor", cuff: "full", read: "floor", breath: "none" };
    dd[k] = { lv, journal: "Call " + i + " — reasoned it through properly today.", det: { train: "session " + i } };
  }
  const d = boot({ "floor.days": dd, "floor.settings": { start: fmt(addDays(today, -60)) } });
  ok("no runtime errors", d.window.__errs.length === 0, d.window.__errs);
  const txt = $(d, "#insights").textContent;
  ok("consistency line uses full/floor/none only",
    /non-zero \(\d+ full · \d+ floor · \d+ none\)/.test(txt), txt.slice(0, 160));
  ok("no 'maintenance' left in insights", !txt.toLowerCase().includes("maintenance"));
  ok("no photo/proof insight", !txt.toLowerCase().includes("photo") && !txt.toLowerCase().includes("proof rate"));
  ok("momentum/trend section present (21+ days)", txt.includes("Momentum") || txt.includes("Design check"));
  ok("log lists 30 rows", (() => { $(d, "#tabLog").click(); return $$(d, "#logList .logrow").length === 30; })(),
    $$(d, "#logList .logrow").length);
}

console.log("\n=================================");
console.log(passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
