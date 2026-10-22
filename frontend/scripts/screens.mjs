// Walks the demo flow against a running app and captures screenshots for design review.
// Usage: node scripts/screens.mjs [outDir] [baseUrl]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "../docs/screenshots";
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

const api = (path, data) => page.request.post(base + path, { data: data ?? {} }).then((r) => r.json());
const shot = async (name, full = true) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  console.log("captured", name);
};
const go = async (path) => { await page.goto(base + path, { waitUntil: "load" }); await page.waitForTimeout(1200); };

await api("/api/sim/reset", { seed: 4242 });
await go("/");
await shot("01-command-centre-start");

await api("/api/sim/step", { ticks: 40 });
await go("/assets/BRG-017");
await shot("02-asset-bridge-truck-transient");

await api("/api/sim/advance-to-event");
const state = await (await page.request.get(base + "/api/state")).json();
const inc = state.incidents.at(-1).incident_id;
await go("/");
await shot("03-command-centre-anomaly");
await go("/assets/BRG-017");
await shot("04-asset-bridge-anomaly");
await go(`/incidents/${inc}`);
await shot("05-investigation");
await page.getByRole("button", { name: /Investigator:/ }).click();
await shot("06-investigation-agent-expanded");
await page.getByRole("button", { name: "Why was this flagged?" }).first().click();
await shot("07-why-flagged", false);
await page.keyboard.press("Escape");

await go(`/incidents/${inc}/plan`);
await shot("08-planner-proposal");
await page.getByRole("button", { name: "Approve work order" }).click();
await page.waitForTimeout(800);
await shot("09-planner-approved");

await go(`/incidents/${inc}/verify`);
await page.getByRole("button", { name: /Logger outage/ }).click();
await shot("10-verify-cannot-assess");
await page.getByRole("button", { name: /Deviation persists/ }).click();
await shot("11-verify-persists");

await go(`/incidents/${inc}/replay`);
await page.getByRole("button", { name: /Replay investigation/ }).first().click();
await page.waitForTimeout(1500);
await shot("12-decision-replay");

await go("/whatif");
await page.getByRole("button", { name: /Run what-if/ }).click();
await page.waitForTimeout(2500);
await shot("13-whatif-frozen-midspan");

await go("/schematic");
await shot("14-schematic");
await go("/simulation");
await shot("15-simulation");
await go("/metrics");
await page.waitForTimeout(6000);
await shot("16-metrics");
await go("/audit");
await shot("17-audit", false);

await api("/api/sim/step", { ticks: 200 });
await go("/");
await shot("18-command-centre-end");
await page.evaluate(() => { localStorage.setItem("ig-theme", "light"); });
await go(`/incidents/${inc}`);
await shot("19-investigation-light");
await go("/");
await shot("20-command-centre-light");
await page.evaluate(() => { localStorage.setItem("ig-theme", "dark"); });
await page.setViewportSize({ width: 1024, height: 768 });
await go("/");
await shot("21-command-centre-1024");
await go(`/incidents/${inc}/plan`);
await shot("22-planner-1024");

console.log("errors:", errors.length ? errors.slice(0, 20) : "none");
await browser.close();
