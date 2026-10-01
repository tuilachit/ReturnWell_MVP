"use client";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  searchPractitioners,
  type DirectoryPage,
  type DistanceGroup,
} from "./directory";
import type { MatchNeeds } from "./matching";
import { WorkflowError } from "./workflow-error";
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
    postcode?: string;
    localityId?: string;
    radiusKm?: number;
  },
) {
  const key = JSON.stringify(filters);
  const [state, setState] = useState<{
    key: string;
    page: DirectoryPage;
    group: DistanceGroup;
    error: string;
    errorCode: string;
    loading: boolean;
  }>({ key: "", page: empty, group: "unknown", error: "", errorCode: "", loading: false });
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
        errorCode: "",
        loading: true,
      });
      void (async () => {
        let group: DistanceGroup =
          request.needs?.appointmentFormat === "telehealth"
            ? "remote"
            : (request.distanceGroup ?? (request.localityId ? "local" : "unknown"));
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
        if (active) setState({ key, page, group, error: "", errorCode: "", loading: false });
      })().catch((error: unknown) => {
        if (active)
          setState({
            key,
            page: empty,
            group: request.distanceGroup ?? "unknown",
            error: error instanceof Error ? error.message : "Could not load this directory page. Try again.",
            errorCode: error instanceof WorkflowError ? error.code : "request_failed",
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
        errorCode: "",
        loading: Boolean(client),
      };
}
