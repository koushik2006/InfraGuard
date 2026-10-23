"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

export interface Crumb { label: React.ReactNode; href?: string }

/** Breadcrumb trail with an explicit back link to the previous level. */
export function Breadcrumbs({ items, right }: { items: Crumb[]; right?: React.ReactNode }) {
  const back = [...items].reverse().find((c, i) => i > 0 && c.href) ?? items[0];
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
        {back?.href && (
          <Link href={back.href} aria-label="Back" className="mr-1 grid h-7 w-7 place-items-center rounded-md border border-line bg-raised text-muted hover:text-text">
            <ChevronLeft size={14} />
          </Link>
        )}
        <ol className="flex min-w-0 flex-wrap items-center gap-1.5">
          {items.map((c, i) => (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight size={12} className="text-faint" aria-hidden />}
              {c.href && i < items.length - 1 ? <Link href={c.href} className="hover:text-text hover:underline">{c.label}</Link>
                : <span aria-current={i === items.length - 1 ? "page" : undefined} className={i === items.length - 1 ? "font-medium text-text" : ""}>{c.label}</span>}
            </li>
          ))}
        </ol>
      </nav>
      {right && <div className="flex flex-wrap items-center gap-1">{right}</div>}
    </div>
  );
}

export function TabLink({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={"rounded-md px-3 py-1.5 text-xs font-medium transition-colors " + (active ? "bg-blue-soft text-blue" : "text-muted hover:bg-raised hover:text-text")}>
      {children}
    </Link>
  );
}
