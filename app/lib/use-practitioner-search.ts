"use client";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  searchPractitioners,
  type DirectoryPage,
  type DistanceGroup,
} from "./directory";
import type { MatchNeeds } from "./matching";
const empty: DirectoryPage = {
  items: [],
  nextCursor: null,
  totalEligible: 0,
  groupCounts: { local: 0, unknown: 0, remote: 0 },
};
export function usePractitionerSearch(
  client: SupabaseClient | null,
  filters: {
    needs?: MatchNeeds;
    query?: string;
    professionId?: string;
    distanceGroup: DistanceGroup | null;
    cursor: string | null;
    refresh?: number;
  },
) {
  const key = JSON.stringify(filters);
  const [state, setState] = useState<{
    key: string;
    page: DirectoryPage;
    group: DistanceGroup;
    error: string;
    loading: boolean;
  }>({ key: "", page: empty, group: "unknown", error: "", loading: false });
  useEffect(() => {
    if (!client) return;
    let active = true;
    const request = JSON.parse(key) as typeof filters;
    const timer = setTimeout(() => {
      setState({
        key,
        page: empty,
        group: request.distanceGroup ?? "unknown",
        error: "",
        loading: true,
      });
      void (async () => {
        let group: DistanceGroup =
          request.needs?.appointmentFormat === "telehealth"
            ? "remote"
            : (request.distanceGroup ?? "unknown");
        let page = await searchPractitioners(client, {
          ...request,
          distanceGroup: group,
        });
        if (
          request.distanceGroup === null &&
          group === "unknown" &&
          page.totalEligible === 0 &&
          page.groupCounts.remote > 0 &&
          !request.cursor
        ) {
          group = "remote";
          page = await searchPractitioners(client, {
            ...request,
            distanceGroup: group,
          });
        }
        if (active) setState({ key, page, group, error: "", loading: false });
      })().catch(() => {
        if (active)
          setState({
            key,
            page: empty,
            group: request.distanceGroup ?? "unknown",
            error: "Could not load this directory page. Try again.",
            loading: false,
          });
      });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, key]);
  return client && state.key === key
    ? state
    : {
        key,
        page: empty,
        group: "unknown" as DistanceGroup,
        error: "",
        loading: Boolean(client),
      };
}
