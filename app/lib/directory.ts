import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchNeeds, MatchResult } from "./matching.ts";
import { invoke } from "./workflow.ts";
import { rowToReferral, type ReferralRow } from "./referrals.ts";
import type { GeographySource, Locality, LocalityLookup } from "./geography.ts";
export type DirectoryPage = {
  geography?: { source: GeographySource | null; origin: Locality | null; radiusKm: number | null };
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
    localityId,
    radiusKm,
    distanceGroup,
    cursor,
    limit,
    query,
    professionId,
  }: {
    needs?: MatchNeeds;
    postcode?: string;
    localityId?: string;
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
    localityId,
    radiusKm,
    distanceGroup,
    cursor: cursor ?? null,
    limit: pageLimit(limit),
    query,
    professionId,
  });
}
export function lookupLocalities(client: SupabaseClient, postcode: string): Promise<LocalityLookup> {
  return invoke(client, "search-practitioners", { lookup: true, postcode });
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
