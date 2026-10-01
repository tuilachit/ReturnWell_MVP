import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchNeeds, MatchResult } from "./matching.ts";
import { invoke } from "./workflow.ts";
import { rowToReferral, type ReferralRow } from "./referrals.ts";
export type DirectoryPage = {
  items: MatchResult[];
  nextCursor: string | null;
  totalEligible: number;
  groupCounts: { local: number; unknown: number; remote: number };
};
export type DistanceGroup = "local" | "unknown" | "remote";
const pageLimit = (limit = 25) =>
  Math.min(50, Math.max(1, Math.trunc(Number.isFinite(limit) ? limit : 25)));
export function searchPractitioners(
  client: SupabaseClient,
  {
    needs,
    postcode,
    radiusKm,
    distanceGroup,
    cursor,
    limit,
    query,
    professionId,
  }: {
    needs?: MatchNeeds;
    postcode?: string;
    radiusKm?: number;
    distanceGroup: DistanceGroup;
    cursor?: string | null;
    limit?: number;
    query?: string;
    professionId?: string;
  },
): Promise<DirectoryPage> {
  return invoke(client, "search-practitioners", {
    needs,
    postcode,
    radiusKm,
    distanceGroup,
    cursor: cursor ?? null,
    limit: pageLimit(limit),
    query,
    professionId,
  });
}
export async function listReferralPage(
  client: SupabaseClient,
  {
    organisationId,
    status,
    search,
    cursor,
    limit,
  }: {
    organisationId: string;
    status?: string;
    search?: string;
    cursor?: string | null;
    limit?: number;
  },
) {
  const page = await invoke<{
    items: ReferralRow[];
    nextCursor: string | null;
    counts: Record<string, number>;
  }>(client, "manage-referral", {
    operation: "list",
    organisationId,
    status,
    search,
    cursor: cursor ?? null,
    limit: pageLimit(limit),
  });
  return { ...page, items: page.items.map(rowToReferral) };
}
