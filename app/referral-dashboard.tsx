"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Referral } from "./types";
import { listReferralPage } from "./lib/directory";
import { professionLabel } from "./lib/professions";
import {
  ArrowUpRight,
  AttentionIcon,
  Check,
  ChevronRight,
  Clock3,
  ReferralIcon,
  X,
} from "./ui-icons";

// Dashboard cards above the referral table. Every number comes from the
// practice's own referrals: status counts from the list endpoint, the weekly
// trend and latest responses from referral activity the doctor can already read.
type Counts = Record<string, number>;
type Activity = {
  event_type: string;
  created_at: string;
  referral_id: string;
  referrals: { reference: string; patient_reference: string } | null;
};
const WEEKS = 8;
const short = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(
    new Date(iso),
  );

export default function ReferralDashboard({
  client,
  organisationId,
  counts,
  loading,
  refreshKey,
  onStatus,
  onOpen,
  onOpenId,
}: {
  client: SupabaseClient | null;
  organisationId: string | null;
  counts?: Counts;
  loading: boolean;
  refreshKey: number;
  onStatus: (status: string) => void;
  onOpen: (referral: Referral) => void;
  onOpenId: (referralId: string) => void;
}) {
  const [attention, setAttention] = useState<Referral[] | null>(null);
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!client || !organisationId) return;
    let active = true;
    const since = new Date(Date.now() - WEEKS * 7 * 86_400_000).toISOString();
    Promise.all([
      listReferralPage(client, { organisationId, status: "declined", limit: 4 }),
      client
        .from("referral_events")
        .select("event_type,created_at,referral_id,referrals!inner(reference,patient_reference,organisation_id)")
        .eq("referrals.organisation_id", organisationId)
        .in("event_type", ["created", "accepted", "declined"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000),
    ])
      .then(([page, events]) => {
        if (!active) return;
        setAttention(page.items);
        if (events.error) throw events.error;
        setActivity((events.data ?? []) as unknown as Activity[]);
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [client, organisationId, refreshKey]);

  const sent = counts?.sent ?? 0;
  const accepted = counts?.accepted ?? 0;
  const declined = counts?.declined ?? 0;
  const onboarding = counts?.awaiting_onboarding ?? 0;
  const closed = (counts?.closed ?? 0) + (counts?.cancelled ?? 0);
  const total = counts?.all ?? 0;

  return (
    <div className="dashboard-grid" aria-label="Referral dashboard">
      <section className="dash-card dash-attention" aria-labelledby="dash-attention-title">
        <header>
          <h2 id="dash-attention-title">Needs attention</h2>
          <button className="dash-icon-button" onClick={() => onStatus("declined")} aria-label="Show all referrals needing attention">
            <ArrowUpRight size={16} />
          </button>
        </header>
        <p className="dash-pill-count">
          <span>{loading ? "—" : declined}</span> declined, needing a decision
        </p>
        {failed ? (
          <p className="dash-empty">Could not load this list. Refresh to try again.</p>
        ) : attention === null ? (
          <p className="dash-empty">Loading…</p>
        ) : attention.length === 0 ? (
          <div className="dash-empty dash-clear">
            <Check size={20} />
            <p>Nothing needs your attention right now.</p>
          </div>
        ) : (
          <ul className="dash-tasks">
            {attention.map((referral, index) => (
              <li key={referral.id}>
                <button className={`dash-task tone-${index % 3}`} onClick={() => onOpen(referral)}>
                  <span className="dash-task-icon">
                    <AttentionIcon size={18} />
                  </span>
                  <strong>{referral.patientReference}</strong>
                  <span>
                    {professionLabel(referral.profession)} · {referral.providerName}
                  </span>
                  <small>Declined · updated {short(referral.updatedAt)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <StatusDonut
        loading={loading}
        segments={[
          { key: "accepted", label: "Accepted", value: accepted },
          { key: "sent", label: "Awaiting response", value: sent },
          { key: "declined", label: "Declined", value: declined },
        ]}
        onStatus={onStatus}
      />

      <TrendCard activity={activity} failed={failed} />

      <section className="dash-card dash-progress" aria-labelledby="dash-progress-title">
        <header>
          <h2 id="dash-progress-title">Response progress</h2>
          <span className="dash-caption">{loading ? "—" : `${total} referrals`}</span>
        </header>
        <ul>
          {[
            { key: "sent", label: "Awaiting response", value: sent, series: "awaiting" },
            { key: "accepted", label: "Accepted", value: accepted, series: "accepted" },
            { key: "declined", label: "Declined", value: declined, series: "declined" },
            { key: "awaiting_onboarding", label: "Practitioner onboarding", value: onboarding, series: "onboarding" },
            { key: "closed", label: "Closed or cancelled", value: closed, series: "context" },
          ].map((row) => (
            <li key={row.key}>
              <button onClick={() => onStatus(row.key)} aria-label={`${row.label}: ${row.value} of ${total}. Show these referrals`}>
                <span className="dash-meter-label">{row.label}</span>
                <span className="dash-meter-value">
                  {loading ? "—" : row.value}
                  <small> of {loading ? "—" : total}</small>
                </span>
                <span className="dash-meter" aria-hidden="true">
                  <span
                    className={`series-${row.series}`}
                    style={{ width: total ? `${Math.max(row.value ? 2 : 0, (row.value / total) * 100)}%` : "0%" }}
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="dash-card dash-latest" aria-labelledby="dash-latest-title">
        <header>
          <h2 id="dash-latest-title">Latest responses</h2>
        </header>
        {failed ? (
          <p className="dash-empty">Could not load responses.</p>
        ) : activity === null ? (
          <p className="dash-empty">Loading…</p>
        ) : (
          <LatestResponses activity={activity} onOpenId={onOpenId} />
        )}
      </section>
    </div>
  );
}

function LatestResponses({ activity, onOpenId }: { activity: Activity[]; onOpenId: (id: string) => void }) {
  const responses = activity.filter((item) => item.event_type !== "created").slice(0, 4);
  if (!responses.length)
    return (
      <div className="dash-empty">
        <Clock3 size={20} />
        <p>No practitioner responses in the last {WEEKS} weeks.</p>
      </div>
    );
  return (
    <ul className="dash-responses">
      {responses.map((item) => (
        <li key={item.referral_id + item.created_at}>
          <button onClick={() => onOpenId(item.referral_id)}>
            <span className={`dash-response-icon ${item.event_type}`} aria-hidden="true">
              {item.event_type === "accepted" ? <Check size={16} /> : <X size={16} />}
            </span>
            <span>
              <strong>{item.referrals?.patient_reference ?? "Referral"}</strong>
              <small>
                {item.event_type === "accepted" ? "Accepted" : "Declined"} · {short(item.created_at)}
              </small>
            </span>
            <ChevronRight size={15} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function StatusDonut({
  segments,
  loading,
  onStatus,
}: {
  segments: { key: string; label: string; value: number }[];
  loading: boolean;
  onStatus: (status: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const gap = total > 0 && segments.filter((s) => s.value > 0).length > 1 ? 3 : 0;
  const lengths = segments.map((segment) => (total ? (segment.value / total) * circumference : 0));
  const arcs = segments.map((segment, index) => ({
    ...segment,
    dash: Math.max(0, lengths[index] - gap),
    start: lengths.slice(0, index).reduce((sum, length) => sum + length, 0),
  }));
  const shown = segments.find((s) => s.key === hover);
  const series: Record<string, string> = { accepted: "accepted", sent: "awaiting", declined: "declined" };
  return (
    <section className="dash-card dash-status" aria-labelledby="dash-status-title">
      <header>
        <h2 id="dash-status-title">Referral status</h2>
        <button className="dash-icon-button" onClick={() => onStatus("all")} aria-label="Show all referrals">
          <ArrowUpRight size={16} />
        </button>
      </header>
      <div className="dash-donut">
        <svg viewBox="0 0 160 160" role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(", ")}>
          <circle className="dash-donut-track" cx="80" cy="80" r={radius} />
          {arcs.map((arc) =>
            arc.dash > 0 ? (
              <circle
                key={arc.key}
                className={`dash-donut-arc series-${series[arc.key]}${hover && hover !== arc.key ? " dimmed" : ""}`}
                cx="80"
                cy="80"
                r={radius}
                strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
                strokeDashoffset={-arc.start}
                onPointerEnter={() => setHover(arc.key)}
                onPointerLeave={() => setHover(null)}
              />
            ) : null,
          )}
        </svg>
        <div className="dash-donut-centre" aria-hidden="true">
          <strong>{loading ? "—" : shown ? shown.value : total}</strong>
          <span>{shown ? shown.label : "Active referrals"}</span>
        </div>
      </div>
      <ul className="dash-legend">
        {segments.map((segment) => (
          <li key={segment.key}>
            <button
              onClick={() => onStatus(segment.key)}
              onPointerEnter={() => setHover(segment.key)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(segment.key)}
              onBlur={() => setHover(null)}
              aria-label={`${segment.label}: ${segment.value}. Show these referrals`}
            >
              <i className={`series-${series[segment.key]}`} aria-hidden="true" />
              {segment.label}
              <strong>{loading ? "—" : segment.value}</strong>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TrendCard({ activity, failed }: { activity: Activity[] | null; failed: boolean }) {
  const weeks = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (WEEKS - 1) * 7);
    return Array.from({ length: WEEKS }, (_, index) => {
      const from = new Date(start);
      from.setDate(start.getDate() + index * 7);
      const to = new Date(from);
      to.setDate(from.getDate() + 7);
      const inWeek = (activity ?? []).filter((item) => {
        const at = new Date(item.created_at);
        return at >= from && at < to;
      });
      return {
        label: short(from.toISOString()),
        sent: inWeek.filter((item) => item.event_type === "created").length,
        accepted: inWeek.filter((item) => item.event_type === "accepted").length,
      };
    });
  }, [activity]);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [focus, setFocus] = useState<number | null>(null);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.floor(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = 190;
  const pad = { top: 12, right: 10, bottom: 8, left: 26 };
  const max = Math.max(4, ...weeks.map((w) => Math.max(w.sent, w.accepted)));
  const ticks = [0, Math.ceil(max / 2), max];
  const x = (index: number) => pad.left + (index * (width - pad.left - pad.right)) / (WEEKS - 1);
  const y = (value: number) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom);
  const path = (key: "sent" | "accepted") =>
    weeks.map((week, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(week[key]).toFixed(1)}`).join(" ");
  const area = `${path("accepted")} L${x(WEEKS - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const current = focus === null ? null : weeks[focus];
  // Week labels never collide: keep ~56px between them, always show the latest.
  const spacing = (width - pad.left - pad.right) / (WEEKS - 1);
  const step = Math.max(1, Math.ceil(56 / spacing));
  const labelled = new Set(
    Array.from({ length: WEEKS }, (_, index) => WEEKS - 1 - index * step).filter((index) => index >= 0),
  );
  const totals = weeks.reduce((sum, w) => ({ sent: sum.sent + w.sent, accepted: sum.accepted + w.accepted }), { sent: 0, accepted: 0 });
  return (
    <section className="dash-card dash-trend" aria-labelledby="dash-trend-title">
      <header>
        <h2 id="dash-trend-title">Sent vs accepted</h2>
        <span className="dash-caption">Last {WEEKS} weeks</span>
      </header>
      <ul className="dash-legend dash-legend-inline">
        <li>
          <i className="series-accepted line" aria-hidden="true" />
          Accepted <strong>{totals.accepted}</strong>
        </li>
        <li>
          <i className="series-context line" aria-hidden="true" />
          Sent <strong>{totals.sent}</strong>
        </li>
      </ul>
      {failed ? (
        <p className="dash-empty">Could not load activity.</p>
      ) : (
        <div
          className="dash-trend-plot"
          ref={box}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - rect.left - pad.left) / (rect.width - pad.left - pad.right);
            setFocus(Math.min(WEEKS - 1, Math.max(0, Math.round(ratio * (WEEKS - 1)))));
          }}
          onPointerLeave={() => setFocus(null)}
        >
          <input
            className="dash-week-input"
            type="range"
            min={0}
            max={WEEKS - 1}
            step={1}
            value={focus ?? WEEKS - 1}
            aria-label="Week to read"
            aria-valuetext={current ? `Week of ${current.label}: ${current.accepted} accepted, ${current.sent} sent` : undefined}
            onFocus={() => setFocus(WEEKS - 1)}
            onBlur={() => setFocus(null)}
            onChange={(event) => setFocus(Number(event.target.value))}
          />
          <svg width={width} height={height} aria-hidden="true">
            {ticks.map((tick) => (
              <g key={tick}>
                <line className="dash-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
                <text className="dash-axis" x={pad.left - 8} y={y(tick) + 4} textAnchor="end">
                  {tick}
                </text>
              </g>
            ))}
            <path className="dash-area series-accepted" d={area} />
            <path className="dash-line series-context" d={path("sent")} />
            <path className="dash-line series-accepted" d={path("accepted")} />
            {current && focus !== null && (
              <>
                <line className="dash-crosshair" x1={x(focus)} x2={x(focus)} y1={pad.top} y2={y(0)} />
                <circle className="dash-dot series-context" cx={x(focus)} cy={y(current.sent)} r="4.5" />
                <circle className="dash-dot series-accepted" cx={x(focus)} cy={y(current.accepted)} r="4.5" />
              </>
            )}
          </svg>
          {current && focus !== null && (
            <div
              className="dash-tooltip"
              role="status"
              style={{ left: Math.min(Math.max(x(focus), 70), width - 70) }}
            >
              <span>Week of {current.label}</span>
              <span>
                <i className="series-accepted line" /> <strong>{current.accepted}</strong> accepted
              </span>
              <span>
                <i className="series-context line" /> <strong>{current.sent}</strong> sent
              </span>
            </div>
          )}
          <div className="dash-axis-row" aria-hidden="true">
            {weeks.map((week, index) => (
              <span key={week.label} style={{ left: x(index) }}>
                {labelled.has(index) ? week.label : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      <table className="sr-only">
        <caption>Referrals sent and accepted per week</caption>
        <thead>
          <tr>
            <th>Week of</th>
            <th>Sent</th>
            <th>Accepted</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.label}>
              <td>{week.label}</td>
              <td>{week.sent}</td>
              <td>{week.accepted}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dash-footnote">
        <ReferralIcon size={13} /> Sent counts referrals you created; accepted counts practitioner acceptances.
      </p>
    </section>
  );
}
