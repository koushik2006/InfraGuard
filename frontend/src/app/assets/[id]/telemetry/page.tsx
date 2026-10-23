"use client";

import { useParams } from "next/navigation";
import { AssetDetailView } from "@/components/AssetDetailView";

export default function AssetTelemetryPage() {
  const { id } = useParams<{ id: string }>();
  return <AssetDetailView id={id} />;
}
