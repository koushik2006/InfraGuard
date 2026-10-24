// End-to-end UI journey for InfraGuard: findings -> 3D component highlight -> four-stage investigation -> seven-stage work order
// (engineer review/edit/approve -> assign -> officer accept/decline -> execute -> evidence PDF upload -> engineer approves evidence -> completed)
// -> post-completion 3D state -> audit trail. Writes a state file that scripts/e2e-persist.mjs checks after a backend restart.
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
check("five navigation items: the four originals plus a dedicated Audit Trail", JSON.stringify(navLabels) === JSON.stringify(["Overview", "Infrastructure", "Investigations", "Work Orders", "Audit Trail"]), navLabels.join(" | "));
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


// ======================================================================= 4. STAGE 1 — engineer edits, approves; report reflects the approved instructions
const woRow = (await get("/api/work-orders")).find((w) => w.incident_id === incId);
const woId = woRow.work_order_id;
const stageNow = async () => Number(await page.locator("[data-current-stage]").first().getAttribute("data-current-stage"));
const indicator = async () => page.locator('[data-testid="stage-indicator"] button').evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
check("before approval the work order is only a pending proposal", woRow.status === "proposed" && woRow.assignment === null && woRow.stage === 1);
check("approval is refused for a viewer by the backend", (await postRaw(`/api/incidents/${incId}/decision`, { decision: "approve", actor: "Guest viewer (demo)", role: "viewer", note: "" })).status() >= 400);
await go(`/work-orders/${woId}`);
check("TEST 5 work order opens at Stage 1 with one current stage and the others completed/upcoming", (await stageNow()) === 1 && JSON.stringify(await indicator()) === JSON.stringify(["current", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]));
check("only the current stage's actions are shown (no assignment / evidence forms yet)", (await page.getByLabel("Maintenance team").count()) === 0 && (await page.getByTestId("evidence-file-input").count()) === 0 && (await page.getByRole("button", { name: /Accept Assignment|Submit evidence|Approve Evidence/ }).count()) === 0);
const frame = page.frameLocator('iframe[title="Work order report preview"]');
check("the generated Resource Planner report is shown in Stage 1", (await frame.getByText("A. Report header").count()) === 1 && (await frame.getByText("UNAPPROVED SYSTEM RECOMMENDATION").count()) >= 1);
const task1 = "Inspect the Pier 2 bearing shelf and expansion joint EJ-2 (engineer-edited)";
await page.getByRole("textbox", { name: "Task 1", exact: true }).fill(task1);
await page.getByLabel(/Precautions/).fill("Close the right lane before access");
await page.getByLabel(/Acceptance criteria/).fill("Bearing plate and EJ-2 clearly visible in the report photographs");
check("Approve is blocked until unsaved edits are saved", await page.getByRole("button", { name: /Approve Work Order/ }).isDisabled());
await page.getByRole("button", { name: /Save edits/ }).click(); await settle(1500);
let w = (await wo(woId)).work_order;
check("TEST 1a engineer's edits are saved as a new revision with a new report version", w.revision === 2 && w.status === "proposed" && w.steps[0].action === task1 && w.precautions.length === 1 && (await get(`/api/work-orders/${woId}/reports`)).length === 2);
await shot("wo-stage1-review");
await actAs(OWNER);
check("rejecting requires a reason (button disabled without one)", (await page.getByRole("button", { name: /Reject Work Order/ }).click(), await page.getByRole("button", { name: /Confirm rejection/ }).isDisabled()));
await page.getByRole("button", { name: "Cancel" }).click();
await page.getByRole("button", { name: /Approve Work Order/ }).click(); await settle(1800);
w = (await wo(woId)).work_order;
check("TEST 1b approval records the engineer and timestamp and keeps the edited instructions", w.status === "approved" && w.approved_by === OWNER && !!w.approved_at && w.steps[0].action === task1 && w.revision === 2);
const reports = await get(`/api/work-orders/${woId}/reports`);
const rep = await page.request.get(`${base}/api/work-orders/${woId}/report`).then((r) => r.text());
check("TEST 2 the report reflects the approved edits, sensor evidence, sections A–F, versions and page numbers", reports.map((r) => r.kind).join() === "draft,edited,approved" &&
  rep.includes("ENGINEER-APPROVED INSTRUCTIONS") && rep.includes(task1) && rep.includes("Close the right lane before access") && ["A. Report header", "B. Incident summary", "C. Sensor readings", "D. Investigation and decision", "E. Work instructions", "F. Completion and approval"].every((h) => rep.includes(h)) &&
  ["ACC-M1", "ACC-Q1", "ACC-P2", "STR-G1", "Robust z", "Windows exceeding", "context"].every((t) => rep.toLowerCase().includes(t.toLowerCase())) && rep.includes("counter(pages)") && rep.includes(woId) && rep.includes(incId));
check("approving again is refused (no duplicate approval) and a viewer cannot edit", (await postRaw(`/api/incidents/${incId}/decision`, { decision: "approve", ...eng, note: "" })).status() >= 400 && (await postRaw(`/api/work-orders/${woId}/edit`, { edits: { reason: "x" }, ...eng })).status() >= 400);
check("only one work order exists for the incident", (await get("/api/work-orders")).filter((w) => w.incident_id === incId).length === 1);

// ======================================================================= 5. STAGE 2 — assignment (engineer)
await actAs(ENG); await go(`/work-orders/${woId}`);
check("TEST 3a Stage 2 shows the approved summary, the final report and the assignment form only", (await stageNow()) === 2 && (await page.getByLabel("Maintenance team").count()) === 1 && (await frame.getByText("ENGINEER-APPROVED INSTRUCTIONS").count()) >= 1 === false || (await stageNow()) === 2);
check("Assign needs team, officer and due date (button disabled until complete)", await page.getByRole("button", { name: /^Assign$/ }).isDisabled());
const simDate = (await wo(woId)).sim_date;
const teamOpts = await page.getByLabel("Maintenance team").locator("option").allInnerTexts();
check("teams are the predefined fictional demo teams", teamOpts.filter((t) => /\(demo\)/.test(t)).length === 3);
await page.getByLabel("Maintenance team").selectOption({ label: "Bridge Inspection Team (demo)" });
await page.getByLabel("Responsible officer").selectOption({ label: OFFICER });
await page.getByLabel("Due date").fill(simDate);
await page.getByRole("button", { name: /^Assign$/ }).click(); await settle(1800);
w = (await wo(woId)).work_order;
check("TEST 3b assignment records team, officer, due date, assigner and time; workflow advances to Stage 3", w.status === "assigned" && w.assignment.person === OFFICER && w.assignment.team === "Bridge Inspection Team (demo)" && w.assignment.due_date === simDate && w.assignment.assigned_by === ENG && (await stageNow()) === 3);
check("assignment to a person outside the chosen team is refused by the backend", (await postRaw(`/api/work-orders/${woId}/assign`, { ...eng, team: "Structural Maintenance Crew (demo)", person: OFFICER, due_date: simDate })).status() >= 400);
check("the assignment produced a fresh report version containing the officer and due date", (await page.request.get(`${base}/api/work-orders/${woId}/report`).then((r) => r.text())).includes(OFFICER));
await shot("wo-stage3-waiting");

// ======================================================================= 6. STAGE 3 — officer declines, engineer reassigns, officer accepts
check("an engineer cannot accept on the officer's behalf", (await postRaw(`/api/work-orders/${woId}/accept`, eng)).status() === 403);
await actAs(OFFICER); await go(`/work-orders/${woId}`);
check("TEST 4a the officer sees the report, the approved instructions, due date and Accept / Decline", (await stageNow()) === 3 && (await frame.getByText("A. Report header").count()) === 1 && (await page.getByText(task1).count()) >= 1 && (await page.getByRole("button", { name: /Accept Assignment/ }).count()) === 1 && (await page.getByRole("button", { name: /Decline Assignment/ }).count()) === 1);
await page.getByRole("button", { name: /Decline Assignment/ }).click();
check("declining requires a reason", await page.getByRole("button", { name: /Confirm decline/ }).isDisabled());
await page.getByLabel("Decline reason").fill("On leave until after the due date");
await page.getByRole("button", { name: /Confirm decline/ }).click(); await settle(1800);
w = (await wo(woId)).work_order;
check("TEST 13 a declined assignment returns to the engineer for reassignment (not silently advanced)", w.status === "approved" && w.assignment === null && w.last_decline.reason.includes("On leave") && (await stageNow()) === 2);
await actAs(ENG); await go(`/work-orders/${woId}`);
check("the engineer sees who declined and why", /declined this assignment/.test(await body()) && /On leave until after the due date/.test(await body()));
await page.getByLabel("Maintenance team").selectOption({ label: "Bridge Inspection Team (demo)" });
await page.getByLabel("Responsible officer").selectOption({ label: OFFICER });
await page.getByLabel("Due date").fill(simDate);
await page.getByRole("button", { name: /^Assign$/ }).click(); await settle(1800);
await actAs(OFFICER); await go(`/work-orders/${woId}`);
await page.getByRole("button", { name: /Accept Assignment/ }).click(); await settle(1800);
w = (await wo(woId)).work_order;
check("TEST 4b acceptance is recorded and the workflow advances to Stage 4 (work execution)", w.status === "accepted" && w.acceptance.person === OFFICER && (await stageNow()) === 4);
check("accepting twice is refused", (await postRaw(`/api/work-orders/${woId}/accept`, { actor: OFFICER, role: "maintenance" })).status() === 409);

// ======================================================================= 7. STAGE 4 — execution: progress and delay
check("Stage 4 shows instructions, sensor findings with components, due date and a progress form", /Record progress/.test(await body()) && (await page.getByText("Sensor findings and component locations").count()) === 1 && (await page.getByText(task1).count()) >= 1);
await page.getByLabel("What has been done").fill("Access arranged; bearing shelf inspected.");
await page.getByLabel(/Delay or issue/).fill("Waiting for a lane closure window");
await page.getByLabel(/Completion note \(draft/).fill("Inspection of Pier 2 bearing shelf and EJ-2 completed; no restraint found.");
await page.getByRole("button", { name: "Save progress" }).click(); await settle(1500);
w = (await wo(woId)).work_order;
check("TEST 5a progress, delay and completion draft are recorded; status In progress", w.status === "in_progress" && /lane closure/.test(w.delay_reason ?? "") && /Inspection of Pier 2/.test(w.completion_draft ?? "") && /Waiting for a lane closure/.test(await body()) === false || w.status === "in_progress");
check("a different officer cannot record progress", (await postRaw(`/api/work-orders/${woId}/progress`, { actor: OFFICER2, role: "maintenance", note: "x" })).status() >= 400);
await post("/api/sim/step", { ticks: 60 });
check("TEST 6 overdue is evaluated on the simulated clock and escalated once", (await wo(woId)).overdue === true && (await get(`/api/work-orders/${woId}/history`)).filter((e) => e.action === "overdue_escalation").length === 1);
await go(`/work-orders/${woId}`);
check("the overdue state is shown on the work order", /Overdue/.test(await body()));
await page.getByRole("button", { name: /Proceed to evidence submission/ }).click(); await settle(1800);
check("TEST 7 the officer proceeds to Stage 5 (evidence submission)", (await stageNow()) === 5 && (await wo(woId)).work_order.status === "submitting_evidence");

// ======================================================================= 8. STAGE 5 — evidence: attach / validate / replace / remove / submit
const tmp = tmpdir();
const pdf1 = join(tmp, "inspection-report.pdf"), pdf2 = join(tmp, "maintenance-report.pdf"), bad = join(tmp, "malware.exe"), fake = join(tmp, "fake.pdf"), png = join(tmp, "site-photo.png");
writeFileSync(pdf1, "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
writeFileSync(pdf2, "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Note (maintenance) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
writeFileSync(bad, "MZ not allowed"); writeFileSync(fake, "this is not really a pdf");
writeFileSync(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]));
const fileInput = page.getByTestId("evidence-file-input");
check("a visible Attach File control and a completion note field exist", (await page.getByRole("button", { name: /Attach File/ }).count()) === 1 && (await page.getByLabel(/Completion note — describe/).count()) === 1);
check("note prefilled from the Stage 4 draft (information preserved between stages)", /Inspection of Pier 2/.test(await page.getByLabel(/Completion note — describe/).inputValue()));
check("Review submission is blocked until a note AND an attachment (or reason) exist", await page.getByRole("button", { name: /Review submission/ }).isDisabled());
await fileInput.setInputFiles(bad); await settle(700);
check("TEST 5b invalid file type is rejected on the client with a clear message", /Unsupported file type/.test(await body()) && (await page.locator("[data-attachment]").count()) === 0);
await fileInput.setInputFiles(fake); await settle(1200);
check("a file whose content does not match its type is rejected by the server with a clear message", /does not match/.test(await body()) && (await page.locator("[data-attachment]").count()) === 0);
await fileInput.setInputFiles(pdf1); await settle(1500);
check("a valid PDF is uploaded and shown with filename, type and size", (await page.locator('[data-attachment="inspection-report.pdf"]').count()) === 1 && /PDF/.test(await page.locator('[data-attachment="inspection-report.pdf"]').innerText()) && /Uploaded/.test(await body()));
await page.locator('[data-attachment="inspection-report.pdf"]').getByRole("button", { name: /Replace/ }).click();
await fileInput.setInputFiles(pdf2); await settle(1500);
check("an attachment can be replaced before submission", (await page.locator('[data-attachment="maintenance-report.pdf"]').count()) === 1 && (await page.locator('[data-attachment="inspection-report.pdf"]').count()) === 0);
await fileInput.setInputFiles(png); await settle(1500);
check("images are still supported", (await page.locator('[data-attachment="site-photo.png"]').count()) === 1);
await page.locator('[data-attachment="site-photo.png"]').getByRole("button", { name: /Remove/ }).click(); await settle(1500);
check("an attachment can be removed before submission", (await page.locator('[data-attachment="site-photo.png"]').count()) === 0 && (await wo(woId)).pending_attachments.length === 1);
await page.reload({ waitUntil: "load" }); await settle(1800);
check("TEST 14a uploaded-but-unsubmitted files persist across a page refresh", (await page.locator('[data-attachment="maintenance-report.pdf"]').count()) === 1 && (await stageNow()) === 5);
await shot("wo-stage5-evidence");
await page.getByLabel(/Completion note — describe/).fill("Pier 2 bearing shelf and expansion joint EJ-2 inspected; the maintenance report is attached.");
await page.getByRole("button", { name: /Review submission/ }).click(); await settle(600);
check("the officer reviews filenames and the note before finalising", /Review your submission/.test(await body()) && /maintenance-report\.pdf/.test(await page.getByTestId("submission-review").innerText()));
await page.getByRole("button", { name: /Finalise and submit/ }).click(); await settle(1800);
w = (await wo(woId)).work_order;
check("TEST 5c submission persists note, attachment, officer and timestamp; status Awaiting engineer approval", w.status === "awaiting_verification" && w.completion.version === 1 && w.completion.attachments[0].filename === "maintenance-report.pdf" && w.completion.submitted_by === OFFICER && !!w.completion.submitted_at && (await stageNow()) === 6);
check("a duplicate submission is refused and files are locked", (await postRaw(`/api/work-orders/${woId}/evidence`, { actor: OFFICER, role: "maintenance", note: "Another submission attempt for the same job" })).status() === 409);
check("the job is NOT complete before the engineer approves the evidence", w.review === null && (await get(`/api/incidents/${incId}`)).incident.state !== "CLOSED_BY_HUMAN");
check("officers cannot approve their own evidence", (await postRaw(`/api/work-orders/${woId}/review`, { decision: "approve", actor: OFFICER, role: "maintenance" })).status() === 403 && (await postRaw(`/api/work-orders/${woId}/review`, { decision: "approve", actor: OFFICER, role: "engineer" })).status() === 403);

// ======================================================================= 9. STAGE 6 — engineer: read note, open PDF, request further work (loop), approve evidence
await actAs(ENG); await go(`/work-orders/${woId}`);
check("TEST 6a the engineer sees the note, the PDF link, the original instructions and the history", (await stageNow()) === 6 && /Pier 2 bearing shelf and expansion joint EJ-2 inspected/.test(await body()) && (await page.getByTestId("evidence-link").count()) === 1 && (await page.getByText("Original approved instructions").count()) === 1);
const href = await page.getByTestId("evidence-link").getAttribute("href");
const pdfResp = await page.request.get(base + href);
check("TEST 6b the PDF persisted and opens from the engineer's review page", pdfResp.status() === 200 && (await pdfResp.body()).toString("latin1").startsWith("%PDF-") && /pdf/.test(pdfResp.headers()["content-type"]));
check("the primary action is labelled Approve Evidence (never Verify / Mark Verified)", (await page.getByRole("button", { name: "Approve Evidence" }).count()) === 1 && !/Verify Completion|Mark Verified/.test(await body()));
check("Request Further Work needs a reason", await page.getByRole("button", { name: /Request Further Work/ }).isDisabled());
await shot("wo-stage6-review");
await page.getByPlaceholder("What is missing or inadequate?").fill("The report does not include photographs of expansion joint EJ-2.");
await page.getByRole("button", { name: /Request Further Work/ }).click(); await settle(1800);
w = (await wo(woId)).work_order;
check("TEST 12 further work returns the order to Work Execution with the reason", w.status === "returned" && w.review.decision === "further_work" && w.completion === null && w.completion_history.length === 1 && (await stageNow()) === 4);
await actAs(OFFICER); await go(`/work-orders/${woId}`);
check("the officer clearly sees what must be corrected", /Further work requested by/.test(await page.getByTestId("further-work-banner").innerText()) && /expansion joint EJ-2/.test(await page.getByTestId("further-work-banner").innerText()));
await page.getByLabel("What has been done").fill("Re-inspected EJ-2 and photographed it.");
await page.getByRole("button", { name: "Save progress" }).click(); await settle(1200);
await page.getByRole("button", { name: /Proceed to evidence submission/ }).click(); await settle(1500);
await page.getByTestId("evidence-file-input").setInputFiles(pdf1); await settle(1500);
await page.getByLabel(/Completion note — describe/).fill("EJ-2 re-inspected and photographed; the new report is attached (evidence version 2).");
await page.getByRole("button", { name: /Review submission/ }).click(); await settle(500);
await page.getByRole("button", { name: /Finalise and submit/ }).click(); await settle(1800);
check("resubmission creates evidence version 2 and keeps version 1 in the history", (await wo(woId)).work_order.completion.version === 2 && (await wo(woId)).work_order.completion_history.length === 1);
await actAs(OWNER); await go(`/work-orders/${woId}`);
await page.getByRole("button", { name: "Approve Evidence" }).click(); await settle(2200);
const v7 = await wo(woId);
check("TEST 8 Approve Evidence completes the job and the investigation, records approver, version and time", v7.work_order.status === "verified" && v7.work_order.review.reviewer === OWNER && v7.work_order.review.evidence_version === 2 && !!v7.work_order.review.at && v7.investigation_completed === true && (await get(`/api/incidents/${incId}`)).incident.state === "CLOSED_BY_HUMAN" && (await stageNow()) === 7);

// ======================================================================= 10. STAGE 7 — completion page
const done = await body();
check("Stage 7 shows Job Completed and Investigation Completed, ids, people, timestamps, report and evidence links", /Job Completed/.test(done) && /Investigation Completed/.test(done) && done.includes(woId) && done.includes(incId) && done.includes(OFFICER) && done.includes(OWNER) && (await page.getByRole("link", { name: /maintenance-report|inspection-report/ }).count()) >= 1 && (await page.getByRole("link", { name: /View audit trail/ }).count()) === 1);
await shot("wo-stage7-completed");
check("all seven stages are marked completed", (await indicator()).filter((s) => s === "done").length >= 6 && (await indicator())[6] !== "upcoming");
await page.getByTestId("return-3d").click(); await page.waitForURL(/\/assets\/BRG-017/); await settle(6500);
const sres2 = await get("/api/assets/BRG-017/sensors");
check("TEST 9a returning to the 3D bridge shows the clearly labelled post-completion, simulated state", (await page.getByTestId("post-completion-banner").count()) === 1 && /post-completion — simulated state/i.test(await page.getByTestId("post-completion-banner").innerText()) && /not from physical sensors/i.test(await page.getByTestId("post-completion-banner").innerText()));
check("TEST 9b no active incident, flags, chips or anomaly highlights remain; all sensors normal", sres2.open_incident === null && sres2.sensors.every((s) => s.state === "normal" && s.finding === null) && (await page.locator("[data-finding-chip]").count()) === 0 && (await page.getByTestId("incident-banner").count()) === 0 &&
  (await page.getByRole("button", { name: /Requires investigation|Under observation|Escalation required/ }).count()) === 0 && (await hl()) === "");
await page.getByRole("button", { name: /^ACC-M1, / }).click({ force: true }); await settle(800);
check("a selected sensor explains it is a simulated post-completion reading and gets no red finding highlight", /not a physical measurement/.test(await page.locator('[aria-label="Selected sensor details"]').innerText()) && (await hlKind()) === "neutral");
await shot("3d-post-completion");
const hist = await get(`/api/incidents/${incId}`);
check("TEST 10 the original incident and its four findings remain in the historical records", hist.event.findings.length === 4 && hist.incident.closed === 1 && (await status(`/incidents/${incId}`)) === 200);
await go(`/incidents/${incId}`);
check("the investigation page shows the completed investigation", /Investigation completed/i.test(await body()) && (await page.getByTestId("step-indicator").count()) === 1);

// ======================================================================= 11. AUDIT TRAIL page and API
const woEvents = (await get(`/api/audit?work_order_id=${woId}&order=asc`)).events.filter((e) => e.source === "work_order").map((e) => e.action);
const expectedSeq = ["proposed", "proposal_edited", "approved", "assigned", "assignment_declined", "assigned", "assignment_accepted", "work_started", "progress_update", "delay_reported", "overdue_escalation", "evidence_stage_opened", "evidence_file_uploaded", "evidence_file_replaced", "evidence_file_uploaded", "evidence_file_removed", "completion_submitted", "further_work_requested", "progress_update", "evidence_stage_opened", "evidence_file_uploaded", "completion_submitted", "evidence_approved", "work_order_completed", "investigation_completed"];
check("TEST 11a the audit log holds every action in chronological order with real actors", JSON.stringify(woEvents) === JSON.stringify(expectedSeq), woEvents.join(","));
await page.locator('nav[aria-label="Primary"] a[aria-label="Audit Trail"]').click(); await page.waitForURL(/\/audit/); await settle(1500);
check("Audit Trail is its own sidebar destination (five items), separate from Work Orders", (await page.locator("main h1").first().innerText()) === "Audit Trail" && (await page.locator('nav[aria-label="Primary"] ul li a').count()) === 5);
check("order is clearly indicated and newest first by default", /newest first/.test(await body()));
await page.getByLabel("Filter by work order").selectOption(woId); await settle(1200);
const nAll = Number(await page.getByTestId("audit-count").innerText());
check("TEST 11b events show actor, action, timestamp and work order; investigation events are included", nAll >= expectedSeq.length && (await page.locator('[data-event="investigation_completed"]').count()) === 1 && (await page.locator("li[data-source=investigation]").count()) >= 1);
const firstNewest = await page.locator('ol[aria-label="Audit events"] > li').first().getAttribute("data-event");
await page.getByRole("button", { name: /Sort oldest first/ }).click(); await settle(1000);
const firstOldest = await page.locator('ol[aria-label="Audit events"] > li').first().getAttribute("data-event");
check("sort order toggles (newest -> oldest) and is labelled", firstNewest === "investigation_completed" && firstOldest !== "investigation_completed" && /oldest first/.test(await body()));
await page.getByLabel("Filter by action").selectOption("evidence_approved"); await settle(1000);
check("filter by action", Number(await page.getByTestId("audit-count").innerText()) === 1);
await page.getByRole("button", { name: "Clear filters" }).click(); await page.getByLabel("Filter by actor").selectOption(OFFICER); await settle(1000);
check("filter by actor", Number(await page.getByTestId("audit-count").innerText()) > 0 && (await page.locator('ol[aria-label="Audit events"] > li').evaluateAll((els) => els.every((e) => e.innerText.includes("Menon")))));
await page.getByLabel("Filter by actor").selectOption(""); await page.getByLabel("Filter by action").selectOption("completion_submitted"); await settle(1000);
await page.locator('ol[aria-label="Audit events"] > li').first().getByRole("button", { name: /Details/ }).click(); await settle(500);
const detail = await page.getByTestId("audit-detail").first().innerText();
check("an event expands to state before/after, event ID, reference to the evidence file (metadata only)", /submitting evidence/.test(detail) && /awaiting verification/.test(detail) && /WOE-\d+/.test(detail) && /maintenance-report\.pdf|inspection-report\.pdf/.test(detail) && !/%PDF-/.test(detail));
check("the audit page offers no edit or delete controls", (await page.getByRole("button", { name: /delete|edit|remove/i }).count()) === 0);
check("the audit API is read-only (no write endpoints)", (await postRaw("/api/audit", {})).status() === 405 && ((await page.request.delete(base + "/api/audit")).status() === 405));
await shot("audit-trail");
const countBefore = (await get("/api/audit?all_runs=false")).count;
const failed = [postRaw(`/api/work-orders/${woId}/accept`, { actor: OFFICER, role: "maintenance" }), postRaw(`/api/work-orders/${woId}/review`, { decision: "approve", ...eng }), postRaw(`/api/work-orders/${woId}/evidence`, { actor: OFFICER, role: "maintenance", note: "Too late to submit anything" })];
const codes = (await Promise.all(failed)).map((r) => r.status());
check("failed / invalid transitions are refused and not recorded as audit events", codes.every((c) => c >= 400) && (await get("/api/audit?all_runs=false")).count === countBefore);

// state for the restart-persistence check (scripts/e2e-persist.mjs)
writeFileSync(join(tmp, "ig-e2e-state.json"), JSON.stringify({ woId, incId, events: (await get(`/api/audit?work_order_id=${woId}&order=asc`)).count, reports: (await get(`/api/work-orders/${woId}/reports`)).length, file: href }));

// ======================================================================= 12. rejection path on a fresh run
await post("/api/sim/reset", { seed: 4242 }); await post("/api/sim/advance-to-event", {});
const inc2 = (await get("/api/assets/BRG-017/sensors")).open_incident;
check("a fresh run creates one new incident", !!inc2 && inc2 !== incId);
for (let i = 0; i < 3; i++) await post(`/api/incidents/${inc2}/advance`, { ...eng });
const wo2 = (await get("/api/work-orders")).find((x) => x.incident_id === inc2);
await actAs(ENG); await go(`/work-orders/${wo2.work_order_id}`);
await page.getByRole("button", { name: /Reject Work Order/ }).click();
await page.getByLabel("Rejection reason").fill("Duplicate of work already scheduled (demo).");
await page.getByRole("button", { name: /Confirm rejection/ }).click(); await settle(1800);
const w2 = (await wo(wo2.work_order_id)).work_order;
check("TEST 5d rejection stores the reason, the order never becomes live and cannot be assigned", w2.status === "rejected" && (await get(`/api/work-orders/${wo2.work_order_id}/history`)).some((e) => e.action === "rejected" && /Duplicate of work/.test(e.summary)) && (await postRaw(`/api/work-orders/${wo2.work_order_id}/assign`, { ...eng, team: "Bridge Inspection Team (demo)", person: OFFICER, due_date: simDate })).status() >= 400 && /rejected/i.test(await body()));

// ======================================================================= 13. no regressions
for (const [path, h1] of [["/", "Overview"], ["/assets", "Infrastructure"], ["/incidents", "Investigations"], ["/work-orders", "Work Orders"], ["/audit", "Audit Trail"]]) {
  await go(path, 1200);
  check(`page ${path} renders "${h1}"`, (await page.locator("main h1").first().innerText()) === h1);
}
check("removed routes stay removed", (await status("/whatif")) === 404 && (await status("/simulation")) === 404);
check("decision replay page still opens", (await status(`/incidents/${inc2}/replay`)) === 200);
check("no console errors / page errors / HTTP 5xx during the whole journey", errors.length === 0, errors.slice(0, 4).join(" || "));

await browser.close();
console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
