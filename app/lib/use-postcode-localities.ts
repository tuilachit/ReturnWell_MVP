"use client";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupLocalities } from "./directory";
import type { LocalityLookup } from "./geography";

export function usePostcodeLocalities(client: SupabaseClient | null, postcode: string, localityId: string) {
  const [state, setState] = useState<{ postcode: string; data: LocalityLookup; error: string } | null>(null);
  const valid = /^[0-9]{4}$/.test(postcode);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!client || !valid) return;
    let active = true;
    const timer = setTimeout(() => {
      void lookupLocalities(client, postcode).then(data => {
        if (active) setState({ postcode, data, error: "" });
      }).catch(() => {
        if (active) setState({ postcode, data: { source: null, localities: [] }, error: "Suburb lookup failed. Retry, or browse without distance." });
      });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [client, postcode, valid, retry]);
  const current = client && valid && state?.postcode === postcode ? state : null;
  const data = current?.data ?? { source: null, localities: [] };
  return {
    ...data,
    selected: data.localities.find(locality => locality.id === localityId),
    loading: Boolean(client && valid && !current),
    error: current?.error ?? "",
    retry: () => { setState(null); setRetry(n => n + 1); },
  };
}
