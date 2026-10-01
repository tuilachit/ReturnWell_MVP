"use client";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getReferralHandover,
  handoverHeading,
  handoverPhoneHref,
  handoverInstructionParts,
  type ReferralHandover,
} from "./lib/handover";
import { errorText } from "./lib/workflow";
export default function HandoverPanel({
  client,
  referralId,
  version,
}: {
  client: SupabaseClient;
  referralId: string;
  version?: number;
}) {
  const [result, setResult] = useState<{
    key: string;
    value?: ReferralHandover;
    error?: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([referralId, version, retry]);
  const value = result?.key === key ? result.value : null;
  const error = result?.key === key ? result.error : null;
  useEffect(() => {
    const refresh = () => setRetry((n) => n + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    let active = true;
    void getReferralHandover(client, referralId)
      .then((value) => {
        if (active) setResult({ key, value });
      })
      .catch((e) => {
        if (active) setResult({ key, error: errorText(e) });
      });
    return () => {
      active = false;
    };
  }, [client, referralId, key]);
  const phone = handoverPhoneHref(value?.contactPhone ?? null);
  return (
    <section className="workflow-card" aria-label="External handover">
      {error ? (
        <>
          <h3>Handover details unavailable</h3>
          <p role="alert">{error}</p>
          <button
            className="button secondary"
            onClick={() => setRetry((n) => n + 1)}
          >
            Retry handover details
          </button>
        </>
      ) : !value ? (
        <p role="status">Loading handover details…</p>
      ) : (
        <>
          <h3>{handoverHeading(value.status)}</h3>
          <p>{value.nextAction}</p>
          {value.reviewedAt && (
            <>
              <h4>Referring practice contact</h4>
              <p>{value.practiceName}</p>
              {value.contactPhone && (
                <p>
                  {phone ? (
                    <a href={phone}>{value.contactPhone}</a>
                  ) : (
                    value.contactPhone
                  )}
                </p>
              )}
              {value.secureInstructions && (
                <p className="handover-instructions">
                  {handoverInstructionParts(value.secureInstructions).map(
                    (part, index) =>
                      part.href ? (
                        <a
                          key={index}
                          href={part.href}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {part.text}
                        </a>
                      ) : (
                        part.text
                      ),
                  )}
                </p>
              )}
              <p>
                Contact independently reviewed{" "}
                {new Date(value.reviewedAt).toLocaleDateString("en-AU")}. Use
                your approved secure channel for identifying patient
                information.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
