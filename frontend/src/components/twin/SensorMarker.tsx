"use client";

import { KIND_ICON, KIND_LABEL, STATE_META, type SensorState } from "./sensors";

/** Accessible DOM marker. Its screen position is written by MarkerProjector inside the 3D scene. */
export function SensorMarker({ s, selected, onSelect, register }: {
  s: SensorState; selected: boolean; onSelect: (id: string) => void; register: (id: string, el: HTMLElement | null) => void;
}) {
  const meta = STATE_META[s.state];
  const Icon = (KIND_ICON[s.kind] ?? KIND_ICON.temperature);
  const filled = s.state === "investigate" || s.state === "escalation";
  const diamond = s.state === "data_quality";
  return (
    <div ref={(el) => register(s.sensor_id, el)} className="pointer-events-none absolute left-0 top-0 will-change-transform" style={{ display: "none" }}>
      <div className="flex flex-col items-center">
        <button
          type="button"
          onClick={() => onSelect(s.sensor_id)}
          aria-pressed={selected}
          aria-label={`${s.sensor_id}, ${KIND_LABEL[s.kind] ?? s.kind}, ${s.location}: ${meta.label}`}
          title={`${s.sensor_id} · ${meta.label}`}
          style={{ color: meta.color, borderColor: meta.color, background: filled ? `${meta.color}33` : "rgba(7,11,16,0.88)",
            boxShadow: selected ? `0 0 0 3px rgba(255,255,255,0.9), 0 0 18px ${meta.color}` : `0 0 12px ${meta.color}55`,
            transform: diamond ? "rotate(45deg)" : undefined }}
          className="pointer-events-auto relative grid h-8 w-8 place-items-center rounded-full border-2 transition-shadow hover:brightness-125"
        >
          {filled && <span className="twin-ping absolute inset-0 rounded-full border-2" style={{ borderColor: meta.color }} aria-hidden />}
          <span style={{ transform: diamond ? "rotate(-45deg)" : undefined }} className="grid place-items-center"><Icon size={15} strokeWidth={2.2} aria-hidden /></span>
          {meta.glyph && (
            <span aria-hidden className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-0.5 text-[10px] font-bold leading-none text-[#0b0f14]"
              style={{ background: meta.color, transform: diamond ? "rotate(-45deg)" : undefined }}>{meta.glyph}</span>
          )}
        </button>
        <span className="mt-1 whitespace-nowrap rounded border border-white/10 bg-black/70 px-1.5 py-px font-mono text-[10px] leading-4" style={{ color: selected ? "#fff" : "#c9d3e0" }}>{s.sensor_id}</span>
      </div>
    </div>
  );
}
