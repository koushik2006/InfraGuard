"use client";

import { Spline } from "lucide-react";
import { BridgeSchematic } from "@/components/BridgeSchematic";
import { Card, PageHeader, SimulatedTag, StatusChip } from "@/components/ui";
import { useApp } from "@/lib/store";

export default function SchematicPage() {
  const { state } = useApp();
  const bridge = state?.assets.find((a) => a.asset_id === "BRG-017");
  return (
    <div>
      <PageHeader eyebrow={<><Spline size={13} /> Interactive bridge schematic <SimulatedTag /></>} title="Riverside Road Bridge — sensor map"
        subtitle="An explanatory visualisation of the simulated scenario. It is not a structural model, an engineering drawing, or a representation of certified physical condition. Click or Tab to a sensor, then Enter, to see its live state."
        right={bridge && <StatusChip status={bridge.status} />} />
      <Card className="p-5"><BridgeSchematic /></Card>
      <p className="mt-3 text-xs text-muted">Markers use shape, symbol and label as well as colour: circle with “!” = statistical anomaly, diamond with “?” = sensor / data-quality issue (kept separate from structural anomalies), dashed = context sensor not used for detection.</p>
    </div>
  );
}
