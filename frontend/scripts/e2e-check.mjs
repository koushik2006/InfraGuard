// End-to-end UI journey for InfraGuard: findings -> 3D component highlight -> four-stage investigation -> approval ->
// assignment -> progress -> overdue -> evidence -> verification, with history surviving a refresh.
// Usage (backend :8000 + frontend :3000 running, Chrome installed): node scripts/e2e-check.mjs [outDir] [baseUrl]
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = process.argv[2] ?? "../docs/screenshots";
const base = process.argv[3] ?? "http://localhost:3000";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
const post = (path, data) => page.request.post(base + path, { data: data ?? {} }).then((r) => r.json());
const postRaw = (path, data) => page.request.post(base + path, { data: data ?? {} });
const get = (path) => page.request.get(base + path).then((r) => r.json());
const status = (path) => page.request.get(base + path).then((r) => r.status());
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(ok ? "PASS" : "FAIL", label, extra); };
const settle = (ms = 1500) => page.waitForTimeout(ms);
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.png` }); };
const go = async (path, wait = 1500) => { await page.goto(base + path, { waitUntil: "load" }); await settle(wait); };
const body = () => page.locator("body").innerText();
const actAs = async (name) => { await page.locator('select[aria-label="Acting user (demo identity)"]').selectOption({ label: name }); await settle(400); };
const ENG = "A. Rao (demo engineer)", OFFICER = "R. Menon (demo officer)", OFFICER2 = "S. Gupta (demo officer)", OWNER = "K. Iyer (demo asset owner)";
const stepText = () => page.getByTestId("step-indicator").textContent();
const wo = async (id) => (await get(`/api/work-orders/${id}`));
const eng = { actor: ENG, role: "engineer" };
const hl = () => page.locator("[data-highlight]").first().getAttribute("data-highlight");
const hlKind = () => page.locator("[data-highlight]").first().getAttribute("data-highlight-kind");

// ======================================================================= 0. navigation and scope
await post("/api/sim/reset", { seed: 4242 });
await go("/");
const navLabels = await page.locator('nav[aria-label="Primary"] ul li a').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
check("four navigation items, no extra tab for verification", JSON.stringify(navLabels) === JSON.stringify(["Overview", "Infrastructure", "Investigations", "Work Orders"]), navLabels.join(" | "));
check("only Bridge Alpha is visible", !/Civic Annex|Hillside|BLD-204|RW-031/i.test(await body()) && JSON.stringify((await get("/api/assets")).map((a) => a.asset_id)) === '["BRG-017"]');

// ======================================================================= 1. run to the anomaly: flags map to findings
await post("/api/sim/advance-to-event", {});
const sres = await get("/api/assets/BRG-017/sensors");
const incId = sres.open_incident;
const flagged = sres.sensors.filter((s) => s.state !== "normal" && s.state !== "data_quality");
const findingSensors = new Set(sres.incident.finding_sensors);
check("TEST 1a every flagged sensor has a real finding in the incident", flagged.length >= 3 && flagged.every((s) => s.finding && findingSensors.has(s.sensor_id) && s.incident_id === incId), flagged.map((s) => s.sensor_id).join(","));
check("TEST 1b no finding is invented: each finding's sensor really exceeds its own baseline", sres.incident.finding_sensors.every((id) => { const s = sres.sensors.find((x) => x.sensor_id === id); return s.finding && Math.abs(s.finding.z) > 0 && s.finding.value !== s.finding.baseline_median; }));
const detail0 = await get(`/api/incidents/${incId}`);
check("one incident groups all findings (no duplicate incidents)", detail0.event.findings.length === findingSensors.size && (await get("/api/incidents")).length === 1);

await go("/assets/BRG-017", 6000);
const box = await page.locator("canvas").first().boundingBox();
check("3D canvas present and large", !!box && box.width > 900 && box.height >= 550);
const markers = await page.getByRole("button", { name: /^[A-Z]{3}-[A-Z0-9]+, / }).count();
check("9 sensor markers", markers === 9, String(markers));
const flaggedMarkers = await page.getByRole("button", { name: /Requires investigation|Under observation|Escalation required/ }).count();
check("flagged markers on the model equal the findings of the incident", flaggedMarkers === findingSensors.size, `${flaggedMarkers} vs ${findingSensors.size}`);
check("banner groups the findings and lists each as a chip", (await page.locator("[data-finding-chip]").count()) === findingSensors.size && /\d findings?/.test(await page.locator('[data-testid="incident-banner"]').innerText()));
check("nothing is selected or highlighted by default", (await hl()) === "" && (await page.locator('[aria-label="Selected sensor details"]').count()) === 0);

// ======================================================================= 2. click a flag -> correct finding + component highlight
const expectComp = Object.fromEntries(sres.sensors.map((s) => [s.sensor_id, s.component]));
let allRight = true; const seen = [];
for (const id of ["ACC-M1", "ACC-Q1", "ACC-P2", "STR-G1"]) {
  await page.getByRole("button", { name: new RegExp(`^${id}, `) }).click({ force: true }); await settle(700);
  const panel = await page.locator('[aria-label="Selected sensor details"]').innerText();
  const ok = (await hl()) === expectComp[id].id && (await hlKind()) === "finding" && panel.includes(expectComp[id].name) && panel.includes(id);
  seen.push(`${id}->${await hl()}`); if (!ok) allRight = false;
}
check("TEST 11 selecting each finding highlights its own mapped component in red and the panel names it", allRight, seen.join(" "));
await page.getByRole("button", { name: /^ACC-Q1, / }).click({ force: true }); await settle(900);
await shot("3d-finding-highlight");
const panelTxt = await page.locator('[aria-label="Selected sensor details"]').innerText();
check("panel shows component, sensor, observed anomaly and why it was flagged", /quarter point/i.test(panelTxt) && /ACC-Q1/.test(panelTxt) && /Observed/.test(panelTxt) && /Baseline/.test(panelTxt) && /persistence|window/i.test(panelTxt));
check("highlight is explained as location, not proof of damage", /not proof of damage/i.test(panelTxt));
await page.getByRole("button", { name: "Clear selection and highlight" }).click(); await settle(600);
check("deselecting restores the model (no highlight, no panel)", (await hl()) === "" && (await page.locator('[aria-label="Selected sensor details"]').count()) === 0);
await page.getByRole("button", { name: /^TMP-B1, / }).click({ force: true }); await settle(700);
check("a normal sensor gets a neutral (non-red) location highlight", (await hl()) === "deck_s1" && (await hlKind()) === "neutral");
await page.getByRole("button", { name: "Clear selection and highlight" }).click(); await settle(400);
// fallback when the backend has no component for a sensor
await page.route("**/api/assets/BRG-017/sensors", async (route) => {
  const r = await route.fetch(); const j = await r.json();
  j.sensors = j.sensors.map((s) => s.sensor_id === "ACC-M1" ? { ...s, component: { id: null, name: null, mapped: false } } : s);
  await route.fulfill({ response: r, json: j });
});
await go("/assets/BRG-017", 6000);
await page.getByRole("button", { name: /^ACC-M1, / }).click({ force: true }); await settle(700);
check("unmapped sensor: 'Component mapping unavailable' and no arbitrary highlight", (await hl()) === "" && /Component mapping unavailable/.test(await page.locator('[aria-label="Selected sensor details"]').innerText()));
await page.unroute("**/api/assets/BRG-017/sensors");

// ---- clicking a flag opens the matching finding in the investigation
await go("/assets/BRG-017", 6000);
await page.getByRole("button", { name: /^ACC-P2, / }).click({ force: true }); await settle(700);
await page.getByRole("link", { name: /Open this finding/ }).click(); await page.waitForURL(/\/incidents\/INC-\d+\?finding=ACC-P2/); await settle(1500);
check("TEST 2 clicking a flag opens that finding in the investigation", (await page.locator('[data-finding="ACC-P2"]').getAttribute("aria-pressed")) === "true" && page.url().includes(incId));

// ======================================================================= 3. four sequential stages
const noJson = async () => !/No external tool calls|get_baseline|tool_calls|"sensor_id"|\{"/.test(await body());
check("TEST 4a stage 1 of 4 shows only the Sentinel's detection", (await stepText()) === "Step 1 of 4" && /Sentinel/.test(await body()) && !/competing hypotheses|contributing findings|recommended preventive action/i.test(await body()));
check("stage 1 lists every finding with observed value, baseline, z, since and reason", (await page.locator("[data-finding]").count()) === findingSensors.size && /Why flagged/.test(await body()) && /Baseline \(median\)/.test(await body()));
check("no raw JSON or tool-call traces in the UI", await noJson());
check("Previous Step is disabled on the first stage", await page.getByRole("button", { name: /Previous Step/ }).isDisabled());
check("no follow-up readings control anywhere in the main workflow", !/follow-up readings|Load follow-up|Verifier/i.test(await body()));
await shot("investigation-step1");

// failing stage -> error with retry, nothing recorded; then retry with a visible running state
const agentRuns = async () => (await get(`/api/incidents/${incId}`)).agent_runs.length;
const runsBefore = await agentRuns();
let advCalls = 0, failNext = true;
await page.route("**/api/incidents/*/advance", async (route) => {
  advCalls++;
  if (failNext) { failNext = false; await route.abort(); } else { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); }
});
await page.getByRole("button", { name: /Next Step/ }).click(); await settle(900);
check("a failed stage shows an error with Retry and records nothing", (await page.locator('[role=alert]', { hasText: "did not complete" }).innerText()).includes("did not complete") && (await agentRuns()) === runsBefore && (await get(`/api/incidents/${incId}`)).incident.state === "DETECTED");
await page.getByRole("button", { name: /Retry/ }).click();
let sawRunning = false;
try { await page.getByText(/Investigating anomaly and gathering evidence/).waitFor({ timeout: 1400 }); sawRunning = true; } catch {}
check("real execution progress is shown while the agent runs", sawRunning);
await page.getByTestId("step-indicator").filter({ hasText: /Step 2 of 4/i }).waitFor({ timeout: 8000 });
check("TEST 4b stage 2 shows only the Investigator's evidence", /Investigator/.test(await body()) && /competing hypotheses/i.test(await body()) && /supports/i.test(await body()) && !/contributing findings/i.test(await body()));
check("evidence is shown for every finding with supports / contradicts and data quality", (await page.getByText("Data quality:").count()) === findingSensors.size);
check("evidence stage has no raw JSON / tool traces", await noJson());
await shot("investigation-step2");
await page.getByRole("button", { name: /Next Step/ }).click(); await page.getByTestId("step-indicator").filter({ hasText: /Step 3 of 4/i }).waitFor({ timeout: 8000 }); await settle(500);
const tri = (await get(`/api/incidents/${incId}`)).triage.at(-1);
check("TEST 3 every finding contributes to the risk assessment (API)", new Set(tri.contributing_findings.map((c) => c.sensor_id)).size === findingSensors.size && [...findingSensors].every((s) => tri.contributing_findings.some((c) => c.sensor_id === s)));
const ctxRows = await page.locator("li", { hasText: /counted|context|corroborat|primary/i }).count();
check("assessment stage lists each contributing finding, rule factors, persistence and uncertainty", /Contributing findings/.test(await body()) && /Severity rationale/.test(await body()) && /Persistence/.test(await body()) && /Uncertainty/.test(await body()) && ctxRows >= findingSensors.size);
check("assessment shows no invented confidence score", !/confidence\s*[:=]?\s*\d|% confidence|probability of failure\s*\d/i.test(await body()));
await shot("investigation-step3");
await page.getByRole("button", { name: /Next Step/ }).click(); await page.getByTestId("step-indicator").filter({ hasText: /Step 4 of 4/i }).waitFor({ timeout: 8000 }); await settle(500);
check("TEST 4c stage 4 shows the Planner's proposed action and approval controls", /Recommended preventive action/.test(await body()) && (await page.getByRole("button", { name: "Approve", exact: true }).count()) === 1 && /Pending approval/.test(await body()));
check("no Next Step button on the final stage", (await page.getByRole("button", { name: /Next Step/ }).count()) === 0);
check("exactly one advance call per executed stage (plus the one aborted attempt)", advCalls === 4, String(advCalls)); // aborted + retry(stage 2) + stage 3 + stage 4
await page.unroute("**/api/incidents/*/advance");
await shot("investigation-step4");

// results preserved when navigating
const runsAfter = await agentRuns();
await page.getByRole("button", { name: /Previous Step/ }).click(); await settle(400);
check("Previous Step returns to stage 3 with its results intact", (await stepText()) === "Step 3 of 4" && /contributing findings/i.test(await body()));
await page.getByRole("button", { name: /Previous Step/ }).click(); await page.getByRole("button", { name: /Previous Step/ }).click(); await settle(400);
check("going back to stage 1 shows the detection again", (await stepText()) === "Step 1 of 4" && (await page.locator("[data-finding]").count()) === findingSensors.size);
await page.getByRole("button", { name: /Next Step/ }).click(); await settle(500);
check("moving forward through completed stages does not re-run any agent", (await stepText()) === "Step 2 of 4" && (await agentRuns()) === runsAfter);
await go("/work-orders"); await page.goBack(); await settle(1800);
check("TEST 4d leaving and returning keeps the results and runs nothing again", (await agentRuns()) === runsAfter && /Step \d of 4/i.test(await body()) && (await get("/api/work-orders")).filter((w) => w.incident_id === incId).length === 1);

// ======================================================================= 4. approval / rejection (human decision creates the live work order)
const woRow = (await get("/api/work-orders")).find((w) => w.incident_id === incId);
const woId = woRow.work_order_id;
check("before approval the work order is only a pending proposal", woRow.status === "proposed" && woRow.assignment === null);
check("approval is refused for a viewer by the backend", (await postRaw(`/api/incidents/${incId}/decision`, { decision: "approve", actor: "Guest viewer (demo)", role: "viewer", note: "" })).status() >= 400);
await go(`/work-orders/${woId}`);
await actAs(OWNER); await page.getByRole("button", { name: "Approve", exact: true }).click(); await settle(1500);
const w1 = (await wo(woId)).work_order;
check("TEST 5a approve stores approver, timestamp, linked incident and action", w1.status === "approved" && w1.approved_by === OWNER && !!w1.approved_at && woRow.incident_id === incId && w1.steps.length > 0);
check("approving again is refused (no duplicate approval)", (await postRaw(`/api/incidents/${incId}/decision`, { decision: "approve", actor: ENG, role: "engineer", note: "" })).status() >= 400);
check("only one work order exists for the incident", (await get("/api/work-orders")).filter((w) => w.incident_id === incId).length === 1);

// ======================================================================= 5. assignment
await actAs(ENG); await go(`/work-orders/${woId}`);
check("TEST 6a assignment form has exactly team, person, due date and an Assign button", (await page.locator("form select").count()) === 2 && (await page.locator('form input[type="date"]').count()) === 1 && (await page.getByRole("button", { name: "Assign", exact: true }).count()) === 1);
const simDate = (await wo(woId)).sim_date;
const teamOpts = await page.locator("form select").first().locator("option").allInnerTexts();
check("teams are the predefined fictional demo teams", teamOpts.filter((t) => /\(demo\)/.test(t)).length === 3, teamOpts.join(" | "));
await page.locator("form select").first().selectOption({ label: "Bridge Inspection Team (demo)" });
await page.locator("form select").nth(1).selectOption({ label: OFFICER });
await page.locator('form input[type="date"]').fill(simDate);
await page.getByRole("button", { name: "Assign", exact: true }).click(); await settle(1500);
const w2 = (await wo(woId)).work_order;
check("TEST 6b assignment stores team, person, due date, assigner and time", w2.status === "assigned" && w2.assignment.team === "Bridge Inspection Team (demo)" && w2.assignment.person === OFFICER && w2.assignment.due_date === simDate && w2.assignment.assigned_by === ENG && !!w2.assignment.assigned_at);
check("assigning a person outside the chosen team is refused by the backend", (await postRaw(`/api/work-orders/${woId}/assign`, { ...eng, team: "Structural Maintenance Crew (demo)", person: OFFICER, due_date: simDate })).status() >= 400);
check("a due date in the past is refused", (await postRaw(`/api/work-orders/${woId}/assign`, { ...eng, team: "Bridge Inspection Team (demo)", person: OFFICER, due_date: "2000-01-01" })).status() >= 400);
// reassignment keeps the previous assignment in the history
await page.getByRole("button", { name: /Reassign or change due date/ }).click();
await page.locator("form select").nth(1).selectOption({ label: OFFICER2 });
await page.getByRole("button", { name: /Update assignment/ }).click(); await settle(1500);
check("reassignment replaces the person and keeps the previous one on record", (await wo(woId)).work_order.assignment.person === OFFICER2 && (await get(`/api/work-orders/${woId}/history`)).some((e) => e.action === "reassigned" && /Menon/.test(e.summary)));
await shot("work-order-assigned");

// ======================================================================= 6. progress, overdue
check("a maintenance officer who is not the responsible person cannot record progress", (await postRaw(`/api/work-orders/${woId}/progress`, { actor: OFFICER, role: "maintenance", note: "x" })).status() >= 400);
await actAs(OFFICER2); await go(`/work-orders/${woId}`);
await page.getByLabel("What has been done").fill("Access arranged, inspection of the quarter-point section started.");
await page.getByLabel(/Delay reason/).fill("Waiting for a lane closure window.");
await page.getByRole("button", { name: "Record progress" }).click(); await settle(1500);
const w3 = (await wo(woId)).work_order;
check("TEST 7a progress update moves to In progress and records the delay reason", w3.status === "in_progress" && /lane closure/.test(w3.delay_reason ?? "") && /Waiting for a lane closure/.test(await body()));
check("not overdue before the due date has passed", (await wo(woId)).overdue === false);
await post("/api/sim/step", { ticks: 60 });  // 15 simulated hours: crosses midnight, the due date (today) has passed
await go(`/work-orders/${woId}`);
const vOver = await wo(woId);
check("TEST 7b overdue is shown with an escalation event once", vOver.overdue === true && vOver.escalated === true && /Overdue/.test(await body()) && (await get(`/api/work-orders/${woId}/history`)).filter((e) => e.action === "overdue_escalation").length === 1);
await go("/work-orders");
check("overdue work order is highlighted in the list with its next action", /Overdue/.test(await body()) && /Next:/.test(await body()));
await shot("work-orders-list");
await go(`/work-orders/${woId}`);

// ======================================================================= 7. completion evidence -> awaiting verification (never auto-verified)
await actAs(OFFICER2); await go(`/work-orders/${woId}`);
const evPath = join(tmpdir(), "_evidence.txt"); writeFileSync(evPath, "Simulated demo inspection note: quarter-point deck section inspected; no photo available in this demo.\n");
await page.getByLabel("Completion note (required)").fill("Inspection of the quarter-point deck section completed; findings attached.");
await page.setInputFiles('input[aria-label="Evidence file"]', evPath);
await page.getByRole("button", { name: "Submit evidence" }).click(); await settle(1800);
const w4 = (await wo(woId)).work_order;
check("TEST 8a submitting evidence moves the order to Awaiting Verification, not Verified", w4.status === "awaiting_verification" && w4.completion.attachment?.filename === "_evidence.txt" && w4.review === null);
check("uploaded evidence file is really stored and downloadable", (await page.request.get(`${base}/api/work-orders/${woId}/evidence-file`)).status() === 200);
check("the person who submitted cannot verify their own work", (await postRaw(`/api/work-orders/${woId}/review`, { actor: OFFICER2, role: "maintenance", decision: "verify", reason: "" })).status() >= 400);
check("approval/completion/progress never produce 'verified' on their own", w4.status !== "verified" && (await get("/api/work-orders")).find((w) => w.work_order_id === woId).incident_state !== "CLOSED_BY_HUMAN");
await shot("work-order-awaiting-verification");

// ======================================================================= 8. review: further work, then verify
await actAs(ENG); await go(`/work-orders/${woId}`);
check("further work requires a reason (button disabled until given)", await page.getByRole("button", { name: /Request Further Work/ }).isDisabled());
await page.getByLabel(/Reason \(required for further work\)/).fill("Section between ACC-Q1 and ACC-M1 not covered by the photos.");
await page.getByRole("button", { name: /Request Further Work/ }).click(); await settle(1500);
const w5 = (await wo(woId)).work_order;
check("TEST 8b Request Further Work returns the order to an actionable state", w5.status === "returned" && w5.review.decision === "further_work" && /not covered/.test(w5.review.reason));
await actAs(OFFICER2); await go(`/work-orders/${woId}`);
await page.getByLabel("Completion note (required)").fill("Additional section inspected and photographed.");
await page.getByRole("button", { name: "Submit evidence" }).click(); await settle(1500);
check("resubmitting evidence goes back to Awaiting Verification", (await wo(woId)).work_order.status === "awaiting_verification");
await actAs(OWNER); await go(`/work-orders/${woId}`);
await page.getByRole("button", { name: /Verify Completion/ }).click(); await settle(1800);
const w6 = (await wo(woId)).work_order;
check("TEST 8c Verify Completion marks it Verified with reviewer and time", w6.status === "verified" && w6.review.decision === "verified" && w6.review.reviewer === OWNER && !!w6.review.at);
check("verification closes the incident (human decision), without any follow-up readings", (await get(`/api/incidents/${incId}`)).incident.state === "CLOSED_BY_HUMAN");

// ======================================================================= 9. history persists across refresh
await go(`/work-orders/${woId}#history`);
const histCount = (await get(`/api/work-orders/${woId}/history`)).length;
await page.getByRole("button", { name: /View Activity History/ }).click().catch(() => {}); await settle(1200);
let hist = await page.locator('[aria-label="Activity history"] li').count();
if (hist === 0) { await page.getByRole("button", { name: /View Activity History/ }).click(); await settle(1200); hist = await page.locator('[aria-label="Activity history"] li').count(); }
const histTxt = await page.locator('[aria-label="Activity history"]').innerText();
const wantEvents = ["Approved", "Assigned", "Reassigned", "Progress update", "Overdue", "evidence submitted", "Further work requested", "Verified"];
check("TEST 9a activity history lists approval, assignment, reassignment, progress, overdue, evidence, further work, verification", hist === histCount && wantEvents.every((w) => new RegExp(w, "i").test(histTxt)), `${hist} events; missing: ${wantEvents.filter((w) => !new RegExp(w, "i").test(histTxt)).join(",") || "none"}`);
await shot("work-order-history");
await page.reload({ waitUntil: "load" }); await settle(1500);
if ((await page.locator('[aria-label="Activity history"] li').count()) === 0) { await page.getByRole("button", { name: /View Activity History/ }).click(); await settle(1000); }
check("TEST 9b history is unchanged after a page refresh", (await page.locator('[aria-label="Activity history"] li').count()) === histCount && (await wo(woId)).work_order.status === "verified");

// ======================================================================= 10. rejection path on a fresh run
await post("/api/sim/reset", { seed: 4242 }); await post("/api/sim/advance-to-event", {});
const inc2 = (await get("/api/assets/BRG-017/sensors")).open_incident;
check("a fresh run creates one new incident (never re-opens the closed one)", inc2 && inc2 !== incId);
for (let i = 0; i < 3; i++) await post(`/api/incidents/${inc2}/advance`, { ...eng });
await go(`/incidents/${inc2}`);
check("investigation reopens at the last executed stage", (await stepText()) === "Step 4 of 4");
await page.getByRole("button", { name: "Reject", exact: true }).click();
await page.getByLabel("Rejection reason").fill("Duplicate of work already scheduled (demo).");
await page.getByRole("button", { name: /Confirm reject/ }).click(); await settle(1500);
const wo2 = (await get("/api/work-orders")).find((w) => w.incident_id === inc2);
check("TEST 5b rejection stores the reason and the order never becomes live", wo2.status === "rejected" && (await get(`/api/work-orders/${wo2.work_order_id}/history`)).some((e) => e.action === "rejected") && (await postRaw(`/api/work-orders/${wo2.work_order_id}/assign`, { ...eng, team: "Bridge Inspection Team (demo)", person: OFFICER, due_date: simDate })).status() >= 400);

// ======================================================================= 11. no regressions
for (const [path, h1] of [["/", "Overview"], ["/assets", "Infrastructure"], ["/incidents", "Investigations"], ["/work-orders", "Work Orders"]]) {
  await go(path, 1200);
  check(`page ${path} renders "${h1}"`, (await page.locator("main h1").first().innerText()) === h1);
}
check("removed routes stay removed", (await status("/whatif")) === 404 && (await status("/audit")) === 404 && (await status("/simulation")) === 404);
check("decision replay page still opens", (await status(`/incidents/${inc2}/replay`)) === 200);
check("no console errors / page errors / HTTP 5xx during the whole journey", errors.length === 0, errors.slice(0, 4).join(" || "));

await browser.close();
console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
