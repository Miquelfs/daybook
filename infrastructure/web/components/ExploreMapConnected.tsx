"use client";

import { ExploreMap } from "@/components/ExploreMap";
import { useTravelMapRef } from "@/components/TravelMapContext";
import type { HeatmapData, WorldCoverage } from "@/lib/api";

export function ExploreMapConnected({ points, details }: { points: HeatmapData["points"]; details: WorldCoverage["country_details"] }) {
  const ref = useTravelMapRef();
  return <ExploreMap ref={ref} points={points} details={details} />;
}
