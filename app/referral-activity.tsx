"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import {
  invoke,
  notificationLabel,
  type ReferralNotifications,
} from "./lib/workflow";
type Activity = {
  id: string;
  event_type?: string;
  event_kind?: string;
  created_at: string;
  details: {
    reasonCode?: string;
    note?: string;
    status?: string;
  } | null;
};
export default function ReferralActivity({
  client,
  referralId,
  refresh = 0,
}: {
  client: SupabaseClient;
  referralId: string;
  refresh?: number;
}) {
  const [events, setEvents] = useState<Activity[]>([]);
  const [error, setError] = useState("");
  const [notifications, setNotifications] =
    useState<ReferralNotifications | null>(null);
  const [notificationError, setNotificationError] = useState("");
  const [deliveryRefresh, setDeliveryRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    let run = 0;
    async function load() {
      const version = ++run;
      const delivery = invoke<ReferralNotifications>(
        client,
        "send-referral-notification",
        { referralId },
      )
        .then((result) => {
          if (active && version === run) {
            setNotifications(result);
            setNotificationError("");
          }
        })
        .catch(() => {
          if (active && version === run) {
            setNotifications(null);
            setNotificationError("Email status could not be loaded.");
          }
        });
      const { data, error } = await client
        .from("referral_events")
        .select("*")
        .eq("referral_id", referralId)
        .order("created_at");
      if (!active || version !== run) return;
      if (error) {
        setEvents([]);
        setError("Activity could not be loaded.");
      } else {
        setEvents((data || []) as Activity[]);
        setError("");
      }
      await delivery;
    }
    void load();
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refreshVisible);
    const timer = window.setInterval(refreshVisible, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
    };
  }, [client, referralId, refresh, deliveryRefresh]);
  return (
    <aside className="timeline">
      <h2>Activity</h2>
      {error ? (
        <p role="alert">{error}</p>
      ) : events.length === 0 ? (
        <p>No recorded activity yet.</p>
      ) : (
        <ol>
          {events.map((event) => (
            <li className="done" key={event.id}>
              <i />
              <div>
                <strong>
                  {(
                    event.event_type ||
                    event.event_kind ||
                    "Update"
                  ).replaceAll("_", " ")}
                </strong>
                <span>
                  {new Date(event.created_at).toLocaleString("en-AU")}
                </span>
                {event.details?.status && <p>{event.details.status}</p>}
                {event.details?.reasonCode && (
                  <p>Reason: {event.details.reasonCode.replaceAll("_", " ")}</p>
                )}
                {event.details?.note && <p>{event.details.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      <h2>Email notifications</h2>
      <button
        className="button secondary"
        onClick={() => setDeliveryRefresh((value) => value + 1)}
      >
        Check delivery
      </button>
      {notificationError ? (
        <p role="status">{notificationError}</p>
      ) : !notifications ? (
        <p>Checking email status…</p>
      ) : notifications.notifications.length ? (
        <ul className="workflow-records">
          {notifications.notifications.map((record, index) => (
            <li key={`${record.kind}-${index}`}>
              <strong>{record.kind.replaceAll("_", " ")}</strong>
              <p>{notificationLabel(record)}</p>
              {record.createdAt && (
                <p>{new Date(record.createdAt).toLocaleString("en-AU")}</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          {notifications.status === "configuration_needed"
            ? "Email needs delivery configuration."
            : "No email notification recorded."}
        </p>
      )}
      <p>Email delivery does not mean the referral was read or accepted.</p>
    </aside>
  );
}
