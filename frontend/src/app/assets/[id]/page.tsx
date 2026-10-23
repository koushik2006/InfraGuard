"use client";

import { useParams } from "next/navigation";
import { AssetDetailView } from "@/components/AssetDetailView";
import { BridgeTwin } from "@/components/twin/BridgeTwin";

/** Bridge → full-page 3D digital-twin workspace. Other assets keep their own telemetry-based workspace. */
export default function AssetWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  return id === "BRG-017" ? <BridgeTwin /> : <AssetDetailView id={id} />;
}
