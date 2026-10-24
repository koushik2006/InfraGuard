// Run AFTER scripts/e2e-check.mjs and AFTER restarting the backend: verifies the completed journey survived the restart.
// Usage: node scripts/e2e-persist.mjs [baseUrl]
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const st = JSON.parse(readFileSync(join(tmpdir(), "ig-e2e-state.json"), "utf8"));
let fails = 0;
const check = (label, ok, extra = "") => { if (!ok) fails++; console.log(ok ? "PASS" : "FAIL", label, extra); };
const get = async (p) => (await fetch(base + p)).json();

// the e2e run ended on a fresh scenario reset, so the completed work order belongs to the previous run: read it from the database by id
const wo = await fetch(`${base}/api/work-orders/${st.woId}`);
check("work order still exists after the backend restart", wo.status === 200);
const v = await wo.json();
check("workflow stage and status persisted (Job completed, investigation completed)", v.work_order.status === "verified" && v.investigation_completed === true && v.next_action.stage === 7);
check("review, evidence version and submitting officer persisted", v.work_order.review.evidence_version === 2 && v.work_order.completion.submitted_by === "R. Menon (demo officer)");
const ev = await get(`/api/audit?work_order_id=${st.woId}&order=asc&all_runs=true`);
check("audit history persisted (same number of events)", ev.count === st.events, `${ev.count} vs ${st.events}`);
check("report versions persisted", (await get(`/api/work-orders/${st.woId}/reports`)).length === st.reports);
const f = await fetch(base + st.file);
const bytes = Buffer.from(await f.arrayBuffer());
check("the submitted PDF is still stored and opens", f.status === 200 && bytes.toString("latin1").startsWith("%PDF-"));
const html = await (await fetch(`${base}/api/work-orders/${st.woId}/report`)).text();
check("the final report regenerates from persisted records", html.includes("Report version") && html.includes(st.woId));
process.exit(fails ? 1 : 0);
