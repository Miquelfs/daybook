"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ContactsPicker } from "@/components/ContactsPicker";
import type { Contact } from "@/lib/api";
import { plansApi, type Companion } from "@/lib/plans-api";

/**
 * "With" — who a training or a trip was with. Saves on every change; feeds
 * Plan → People → Together (and, for a training, logs the day together).
 */
export function WithPicker({ activityId, trip }: { activityId?: string; trip?: { start: string; end: string } }) {
  const qc = useQueryClient();
  const key = activityId ? ["with", "activity", activityId] : ["with", "trip", trip!.start, trip!.end];
  const { data: people = [] } = useQuery<Companion[]>({
    queryKey: key,
    queryFn: () => (activityId ? plansApi.activityWith(activityId) : plansApi.tripWith(trip!.start, trip!.end)),
  });

  async function change(next: Contact[]) {
    const ids = next.map((c) => c.id);
    qc.setQueryData(key, next);                                   // optimistic
    const saved = activityId
      ? await plansApi.setActivityWith(activityId, ids)
      : await plansApi.setTripWith(trip!.start, trip!.end, ids);
    qc.setQueryData(key, saved);
    for (const k of ["person", "people"]) qc.invalidateQueries({ queryKey: [k] });
  }

  return (
    <ContactsPicker
      selected={people as Contact[]}
      onChange={change}
      placeholder={activityId ? "Who did you train with?" : "Who came along?"}
    />
  );
}
