import { cx } from "@/lib/format";

export const PANEL = "rounded-xl border border-line bg-surface shadow-[var(--shadow)]";

export function Panel({ title, right, children, className, ...rest }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string } & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section className={cx(PANEL, className)} {...rest}>
      <header className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
        {right}
      </header>
      {children}
    </section>
  );
}
