"use client";

import { useReducedMotion } from "framer-motion";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { IncidentImpact, YearImpact } from "@/lib/impact";

const USUAL = "var(--slate)", WITH = "var(--blue)", SAVED = "var(--amber)";
const AXIS = { fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-sans)" };

interface Row { name: string; usual: number; with: number }

function Tip({ active, payload, label, unit, digits }: { active?: boolean; payload?: { payload: Row }[]; label?: string; unit: string; digits: number }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const f = (v: number) => (unit === "₹ L" ? `₹${v.toFixed(digits)} L` : `${v.toFixed(digits)} h`);
  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-semibold text-text">{label}</p>
      <p className="flex justify-between gap-4 text-muted"><span>Usual process</span><span className="num text-text">{f(r.usual)}</span></p>
      <p className="flex justify-between gap-4 text-muted"><span>With InfraGuard</span><span className="num text-blue">{f(r.with)}</span></p>
      <p className="mt-1 flex justify-between gap-4 border-t border-line-soft pt-1 text-muted"><span>Difference</span><span className="num text-amber">−{f(r.usual - r.with)}</span></p>
    </div>
  );
}

function Grouped({ data, unit, digits, height }: { data: Row[]; unit: "h" | "₹ L"; digits: number; height: number }) {
  const reduce = useReducedMotion();
  const fmt = (v: unknown) => (unit === "₹ L" ? `₹${Number(v).toFixed(digits)} L` : `${Number(v).toFixed(digits)} h`);
  return (
    <div style={{ height }} role="img" aria-label={`Grouped bar chart comparing the usual process with InfraGuard, in ${unit === "h" ? "engineer-hours" : "₹ lakh"}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 0, left: 8 }} barCategoryGap="22%" barGap={3}>
          <CartesianGrid horizontal={false} stroke="var(--line-soft)" />
          <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => (unit === "h" ? `${v} h` : `${v}`)} />
          <YAxis type="category" dataKey="name" width={150} tick={{ ...AXIS, fill: "var(--text)" }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "var(--band)" }} content={<Tip unit={unit} digits={digits} />} />
          <Legend verticalAlign="top" align="right" iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11, color: "var(--muted)", paddingBottom: 6 }} />
          <Bar dataKey="usual" name="Usual process" fill={USUAL} radius={[0, 3, 3, 0]} isAnimationActive={!reduce} animationDuration={600}
            label={{ position: "right", formatter: fmt, fill: "var(--muted)", fontSize: 10 }} />
          <Bar dataKey="with" name="With InfraGuard" fill={WITH} radius={[0, 3, 3, 0]} isAnimationActive={!reduce} animationDuration={800}
            label={{ position: "right", formatter: fmt, fill: "var(--blue)", fontSize: 10, fontWeight: 600 }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Per incident: engineer hours for each step. */
export function HoursChart({ inc }: { inc: IncidentImpact }) {
  return <Grouped height={230} unit="h" digits={1} data={[
    { name: "Triage and investigation", usual: inc.usualTriage, with: inc.withTriage },
    { name: "Work-order report", usual: inc.usualReport, with: inc.withReport },
    { name: "Total engineer effort", usual: inc.usualHours, with: inc.withHours },
  ]} />;
}

/** Per year: each cost line, usual vs with InfraGuard (₹ lakh). */
export function YearChart({ year }: { year: YearImpact }) {
  return <Grouped height={330} unit="₹ L" digits={1} data={year.lines.map((l) => ({ name: l.label, usual: l.usual, with: l.with }))} />;
}

/** Per year: the whole bill, with the saving shown as the gap. */
export function TotalBar({ year }: { year: YearImpact }) {
  const reduce = useReducedMotion();
  const data = [
    { name: "Usual process", cost: year.usual, saved: 0 },
    { name: "With InfraGuard", cost: year.with, saved: year.saved },
  ];
  return (
    <div>
    <div style={{ height: 150 }} role="img" aria-label={`Total annual cost ₹${year.usual.toFixed(0)} lakh with the usual process and ₹${year.with.toFixed(0)} lakh with InfraGuard`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }} barCategoryGap="28%">
          <XAxis type="number" hide domain={[0, Math.ceil(year.usual / 10) * 10]} />
          <YAxis type="category" dataKey="name" width={110} tick={{ ...AXIS, fill: "var(--text)" }} axisLine={false} tickLine={false} />
          <Tooltip cursor={false} content={({ active, payload }) => active && payload?.length ? (
            <div className="rounded-md border border-line bg-raised px-3 py-2 text-xs shadow-xl"><p className="font-semibold text-text">{payload[0].payload.name}</p>
              <p className="num text-muted">Cost ₹{payload[0].payload.cost.toFixed(1)} L{payload[0].payload.saved ? ` · saved ₹${payload[0].payload.saved.toFixed(1)} L` : ""}</p></div>) : null} />
          <Bar dataKey="cost" stackId="a" isAnimationActive={!reduce} animationDuration={700} radius={[3, 0, 0, 3]}>
            {data.map((d, i) => <Cell key={d.name} fill={i === 0 ? USUAL : WITH} />)}
          </Bar>
          <Bar dataKey="saved" stackId="a" fill={SAVED} fillOpacity={0.22} stroke={SAVED} strokeDasharray="4 3" isAnimationActive={!reduce} animationDuration={900} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    <ul className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-1 px-2 text-xs text-muted" aria-label="Chart key">
      <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: USUAL }} /> Usual process <b className="text-text">₹{year.usual.toFixed(0)} L</b></li>
      <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: WITH }} /> With InfraGuard <b className="text-blue">₹{year.with.toFixed(0)} L</b></li>
      <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm border border-dashed" style={{ borderColor: SAVED, background: "rgba(255,176,32,0.22)" }} /> Saved <b className="text-amber">₹{year.saved.toFixed(0)} L</b> ({year.savedPct}% lower)</li>
    </ul>
    </div>
  );
}
