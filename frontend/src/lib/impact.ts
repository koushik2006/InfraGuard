/** Illustrative "usual process vs InfraGuard" model behind the Business Impact page.
 *  Every input is an ASSUMPTION to be confirmed with a real operator; nothing here is a measured saving.
 *  Only the detection time shown on the page comes from the prototype (from the live incident, simulated clock). */

export const ASSUMPTIONS = {
  structures: 10,
  alertsPerMonth: 40,
  engineerRate: 1500,          // ₹ per engineer-hour
  triageHours: 6,              // manual triage and investigation per alert
  triageAutomated: 0.6,
  reportsPerMonth: 12,         // work-order reports across the network
  reportHours: 3,              // drafting a work-order report
  reportAutomated: 0.8,
  needlessCalloutsPerMonth: 8,
  calloutCost: 25000,          // ₹ per callout
  calloutsAvoided: 0.5,
  inspectionsPerYear: 120,
  inspectionCost: 40000,       // ₹ per inspection
  inspectionsSaved: 0.15,
  auditHours: 200,             // audit preparation per year
  auditSaved: 0.5,
  closuresPerYear: 4,
  closureHours: 36,
  closureCostPerHour: 60000,   // ₹ per hour of unplanned closure impact
  closuresAvoided: 0.25,
  platformPerYearLakh: 20,
} as const;

const A = ASSUMPTIONS;
const L = 100000; // ₹ per lakh

export interface IncidentImpact {
  usualTriage: number; usualReport: number; usualHours: number; usualCost: number;
  withTriage: number; withReport: number; withHours: number; withCost: number;
  savedHours: number; savedCost: number; hoursCutPct: number;
  falseAlarmUsual: number;
}

export function perIncident(): IncidentImpact {
  const usualTriage = A.triageHours, usualReport = A.reportHours;
  const withTriage = A.triageHours * (1 - A.triageAutomated), withReport = A.reportHours * (1 - A.reportAutomated);
  const usualHours = usualTriage + usualReport, withHours = withTriage + withReport;
  return {
    usualTriage, usualReport, usualHours, usualCost: usualHours * A.engineerRate,
    withTriage, withReport, withHours, withCost: withHours * A.engineerRate,
    savedHours: usualHours - withHours, savedCost: (usualHours - withHours) * A.engineerRate, hoursCutPct: Math.round((1 - withHours / usualHours) * 100),
    falseAlarmUsual: A.triageHours * A.engineerRate + A.calloutCost,
  };
}

export interface YearLine { key: string; label: string; usual: number; with: number }
export interface YearImpact { lines: YearLine[]; usual: number; with: number; saved: number; savedPct: number; platform: number; net: number }

/** Annual cost lines in ₹ lakh. */
export function perYear(): YearImpact {
  const alerts = A.alertsPerMonth * 12;
  const lines: YearLine[] = [
    { key: "triage", label: "Triage and investigation", usual: (alerts * A.triageHours * A.engineerRate) / L, with: (alerts * A.triageHours * (1 - A.triageAutomated) * A.engineerRate) / L },
    { key: "report", label: "Report drafting", usual: (A.reportsPerMonth * 12 * A.reportHours * A.engineerRate) / L, with: (A.reportsPerMonth * 12 * A.reportHours * (1 - A.reportAutomated) * A.engineerRate) / L },
    { key: "audit", label: "Audit preparation", usual: (A.auditHours * A.engineerRate) / L, with: (A.auditHours * (1 - A.auditSaved) * A.engineerRate) / L },
    { key: "callouts", label: "Needless callouts", usual: (A.needlessCalloutsPerMonth * 12 * A.calloutCost) / L, with: (A.needlessCalloutsPerMonth * 12 * (1 - A.calloutsAvoided) * A.calloutCost) / L },
    { key: "inspections", label: "Calendar inspections", usual: (A.inspectionsPerYear * A.inspectionCost) / L, with: (A.inspectionsPerYear * (1 - A.inspectionsSaved) * A.inspectionCost) / L },
    { key: "closure", label: "Unplanned closure impact", usual: (A.closuresPerYear * A.closureHours * A.closureCostPerHour) / L, with: (A.closuresPerYear * A.closureHours * (1 - A.closuresAvoided) * A.closureCostPerHour) / L },
  ];
  const usual = lines.reduce((a, l) => a + l.usual, 0), w = lines.reduce((a, l) => a + l.with, 0);
  return { lines, usual, with: w, saved: usual - w, savedPct: Math.round(((usual - w) / usual) * 100), platform: A.platformPerYearLakh, net: usual - w - A.platformPerYearLakh };
}

export const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
export const lakh = (v: number, d = 1) => "₹" + v.toFixed(d) + " L";
