"use client";

import { Badge, Card } from "@/components/ui";
import { cx } from "@/lib/format";
import type { Claim, Hypothesis } from "@/lib/types";

const SUPPORT_TONE = { strong: "amber", moderate: "blue", weak: "slate", insufficient: "slate" } as const;

export function Cite({ id, onClick }: { id: string; onClick?: (id: string) => void }) {
  return <button type="button" onClick={() => onClick?.(id)} className="num rounded border border-blue/30 bg-blue-soft px-1 text-[10px] font-semibold text-blue hover:border-blue" aria-label={`Show evidence ${id}`}>{id}</button>;
}

export function ClaimRow({ c, onCite }: { c: Claim; onCite?: (id: string) => void }) {
  return (
    <li className="flex gap-2 text-xs leading-relaxed">
      <Badge tone={c.kind === "observation" ? "neutral" : "violet"} className="mt-0.5 shrink-0 self-start">{c.kind}</Badge>
      <span className="text-text">{c.text} <span className="inline-flex gap-1 align-middle">{c.refs.map((r) => <Cite key={r} id={r} onClick={onCite} />)}</span></span>
    </li>
  );
}

export function HypothesisCard({ h, onCite }: { h: Hypothesis; onCite?: (id: string) => void }) {
  return (
    <Card className={cx("p-4", h.rank === 1 && "card-active")}>
      <div className="flex items-start justify-between gap-2">
        <div><p className="num text-[11px] text-faint">Rank {h.rank} · <span className="text-violet">hypothesis</span></p><p className="mt-0.5 text-sm font-semibold text-text">{h.title}</p></div>
        <Badge tone={SUPPORT_TONE[h.support]} className="capitalize">{h.support}</Badge>
      </div>
      <div className="mt-3 space-y-3">
        <div><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Supports</p>
          {h.evidence_for.length ? <ul className="space-y-1.5">{h.evidence_for.map((c, i) => <ClaimRow key={i} c={c} onCite={onCite} />)}</ul> : <p className="text-xs text-muted">None retrieved.</p>}</div>
        <div><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Contradicts</p>
          {h.evidence_against.length ? <ul className="space-y-1.5">{h.evidence_against.map((c, i) => <ClaimRow key={i} c={c} onCite={onCite} />)}</ul> : <p className="text-xs text-muted">None retrieved.</p>}</div>
      </div>
    </Card>
  );
}
