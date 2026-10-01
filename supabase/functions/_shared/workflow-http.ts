import {
  hashToken,
  invitationEmail,
  newInvitationToken,
  seal,
  type TrustConfig,
  validateTrustConfig,
} from "./workflow-security.ts";
import {
  requireOperatorStepUp,
  requiresStepUp,
  type VerifiedIdentity,
} from "./authorization.ts";
export type Row = Record<string, unknown>;
export type WorkflowRuntime = {
  env: Record<string, string | undefined>;
  getUser: (token: string) => Promise<VerifiedIdentity | null>;
  rpc: (actor: string | null, action: string, input: Row) => Promise<unknown>;
  generateLink?: (
    email: string,
    type: "invite" | "magiclink",
  ) => Promise<{
    userId: string;
    hashedToken: string;
    type: "invite" | "magiclink";
  }>;
};
export const row = (value: unknown): Row => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Error("invalid_request");
  }
  return value as Row;
};
export function trustConfig(env: WorkflowRuntime["env"]): TrustConfig {
  return validateTrustConfig({
    appUrl: env.APP_URL ?? "",
    websiteUrl: env.WEBSITE_URL ?? "",
    businessName: env.RETURNWELL_BUSINESS_NAME ?? "",
    supportEmail: env.SUPPORT_EMAIL ?? "",
    privacyUrl: env.PRIVACY_URL ?? "",
    termsUrl: env.TERMS_URL ?? "",
    termsVersion: env.TERMS_VERSION ?? "",
    privacyVersion: env.PRIVACY_VERSION ?? "",
  });
}
export const pick = (body: Row, keys: string[]) =>
  Object.fromEntries(
    keys.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]),
  );
export async function boundedBody(request: Request, maxBytes = 16 * 1024) {
  if (Number(request.headers.get("content-length")) > maxBytes) {
    throw Error("body_too_large");
  }
  const reader = request.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw Error("body_too_large");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return row(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    throw Error("invalid_request");
  }
}
const mappings: Record<
  string,
  Record<string, { action: string; fields: string[] }>
> = {
  "workspace-access": { default: { action: "workspace.access", fields: [] } },
  "manage-practice": {
    list: {
      action: "practice.list",
      fields: ["organisationId", "cursor", "memberCursor"],
    },
    create: {
      action: "practice.create",
      fields: ["name", "ownerUserId", "evidenceReference", "requestId"],
    },
    reviewContact: {
      action: "practice.reviewContact",
      fields: [
        "organisationId",
        "expectedVersion",
        "contactPhone",
        "contactEmail",
        "secureInstructions",
        "evidenceReference",
        "requestId",
      ],
    },
    reviewInviter: {
      action: "practice.reviewInviter",
      fields: [
        "organisationId",
        "memberId",
        "expectedVersion",
        "displayName",
        "evidenceReference",
        "requestId",
      ],
    },
    revokeMember: {
      action: "practice.revokeMember",
      fields: [
        "organisationId",
        "memberId",
        "expectedVersion",
        "reason",
        "requestId",
      ],
    },
  },
  "search-practitioners": {
    default: {
      action: "directory.search",
      fields: [
        "needs",
        "postcode",
        "radiusKm",
        "distanceGroup",
        "cursor",
        "limit",
        "query",
        "professionId",
      ],
    },
  },
  "manage-referral": {
    "draft.invite": {
      action: "growth.invite",
      fields: [
        "id",
        "expectedVersion",
        "requestId",
        "consentConfirmed",
        "contactConsentConfirmed",
        "contactBasis",
        "recipientName",
        "recipientEmail",
      ],
    },
    "onboarding.status": { action: "growth.status", fields: ["referralId"] },
    "onboarding.reconfirm": {
      action: "growth.reconfirm",
      fields: [
        "referralId",
        "expectedVersion",
        "requestId",
        "consentConfirmed",
      ],
    },
    "handover.read": { action: "referral.handover", fields: ["referralId"] },
    transition: {
      action: "referral.transition",
      fields: [
        "referralId",
        "expectedVersion",
        "requestId",
        "action",
        "reasonCode",
        "note",
        "handoverConfirmed",
      ],
    },
    replace: {
      action: "referral.replace",
      fields: ["referralId", "expectedVersion", "requestId"],
    },
    list: {
      action: "referral.list",
      fields: ["organisationId", "status", "search", "cursor", "limit"],
    },
    "draft.list": { action: "draft.list", fields: ["organisationId"] },
    "draft.load": { action: "draft.load", fields: ["id"] },
    "draft.save": {
      action: "draft.save",
      fields: ["id", "organisationId", "expectedVersion", "input", "requestId"],
    },
    "draft.finalize": {
      action: "draft.finalize",
      fields: ["id", "expectedVersion", "consentConfirmed", "requestId"],
    },
  },
  "manage-invitations": {
    list: { action: "invitations.list", fields: ["organisationId"] },
    preview: {
      action: "invitations.preview",
      fields: ["organisationId", "kind", "recipientName", "recipientEmail"],
    },
    create: {
      action: "invitations.create",
      fields: [
        "kind",
        "organisationId",
        "recipientName",
        "recipientEmail",
        "consentConfirmed",
        "requestId",
      ],
    },
    resend: {
      action: "invitations.resend",
      fields: ["invitationId", "expectedVersion", "requestId"],
    },
    revoke: {
      action: "invitations.revoke",
      fields: ["invitationId", "expectedVersion", "requestId"],
    },
  },
  "claim-invitation": {
    default: {
      action: "invitation.claim",
      fields: ["invitationId", "attemptId", "displayName", "requestId"],
    },
  },
  "practitioner-onboarding": {
    revision_start: {
      action: "application.revision_start",
      fields: ["practitionerId", "requestId"],
    },
    credentials: {
      action: "application.credentials",
      fields: ["practitionerId"],
    },
    load: { action: "application.load", fields: ["applicationId"] },
    save: {
      action: "application.save",
      fields: ["applicationId", "expectedVersion", "profile"],
    },
    submit: {
      action: "application.submit",
      fields: [
        "applicationId",
        "expectedVersion",
        "profileConfirmed",
        "referralConsent",
        "termsVersion",
        "privacyVersion",
      ],
    },
    availability: {
      action: "application.availability",
      fields: ["practitionerId", "acceptingNewReferrals"],
    },
  },
  "review-practitioner": {
    due: { action: "review.due", fields: [] },
    access_detail: {
      action: "review.access_detail",
      fields: ["practitionerId"],
    },
    suspend: {
      action: "review.suspend",
      fields: [
        "practitionerId",
        "expectedVersion",
        "requestId",
        "reason",
        "evidenceReference",
      ],
    },
    restore: {
      action: "review.restore",
      fields: [
        "practitionerId",
        "expectedVersion",
        "requestId",
        "reason",
        "evidenceReference",
      ],
    },
    list: { action: "review.list", fields: [] },
    detail: { action: "review.detail", fields: ["applicationId"] },
    decide: {
      action: "review.decide",
      fields: [
        "applicationId",
        "expectedVersion",
        "decision",
        "identityEvidence",
        "registrationEvidence",
        "applicantFeedback",
        "requestId",
      ],
    },
  },
  "respond-to-referral": {
    default: {
      action: "referral.respond",
      fields: [
        "referralId",
        "expectedVersion",
        "decision",
        "reasonCode",
        "note",
        "requestId",
      ],
    },
  },
  "send-referral-notification": {
    default: { action: "referral.notifications", fields: ["referralId"] },
  },
};
export function workflowHandler(endpoint: string, runtime: WorkflowRuntime) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const allowed = (runtime.env.ALLOWED_ORIGINS ?? runtime.env.APP_URL ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      vary: "Origin",
    };
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers });
    if (origin && !allowed.includes(origin)) {
      return json({ error: "Origin not allowed", code: "origin_denied" }, 403);
    }
    if (origin) headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-headers"] =
      "authorization, apikey, content-type, x-client-info";
    headers["access-control-allow-methods"] = "POST, OPTIONS";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }
    try {
      const body = await boundedBody(request);
      if (endpoint === "invitation-entry") {
        if (
          typeof body.token !== "string" ||
          !/^[A-Za-z0-9_-]{43}$/.test(body.token)
        )
          throw Error("invitation_unavailable");
        const tokenHash = await hashToken(body.token);
        if (body.operation === "inspect") {
          return json({
            ...row(
              await runtime.rpc(null, "invitation.inspect", { tokenHash }),
            ),
            ...trustConfig(runtime.env),
          });
        }
        if (body.operation === "decline") {
          return json(
            await runtime.rpc(null, "invitation.decline", { tokenHash }),
          );
        }
        if (body.operation !== "beginSignup") throw Error("invalid_request");
        const config = trustConfig(runtime.env);
        if (
          body.termsVersion !== config.termsVersion ||
          body.privacyVersion !== config.privacyVersion
        )
          throw Error("terms_changed");
        if (
          !runtime.env.INVITATION_ENCRYPTION_KEY ||
          !runtime.env.INVITATION_KEY_ID ||
          !runtime.generateLink
        )
          throw Error("sender_configuration");
        // Deliberate POST only. Browser fields never determine the recipient,
        // actor, role, auth-link type or redirect destination.
        const attempt = row(
          await runtime.rpc(null, "invitation.begin", {
            tokenHash,
            ...pick(body, [
              "termsVersion",
              "privacyVersion",
              "consentAccepted",
              "requestId",
            ]),
          }),
        );
        if (attempt.alreadyRequested) return json({ ok: true });
        const link = await runtime.generateLink(
          String(attempt.email),
          attempt.existingUserId ? "magiclink" : "invite",
        );
        const url = new URL("/auth/confirm", config.appUrl);
        url.hash = new URLSearchParams({
          token_hash: link.hashedToken,
          type: link.type,
          invitationId: String(attempt.invitationId),
          attemptId: String(attempt.attemptId),
        }).toString();
        const text = `Verify your email for ReturnWell\n\nYou requested access to ReturnWell. Open this link, then choose Verify and continue. It expires in 15 minutes.\n\n${url}\n\nIf you did not request this, ignore this email.\n${config.businessName}\nSupport: ${config.supportEmail}\nWebsite: ${config.websiteUrl}`;
        const envelope = await seal(
          { subject: "Verify your email for ReturnWell", text },
          runtime.env.INVITATION_ENCRYPTION_KEY,
          runtime.env.INVITATION_KEY_ID,
          String(attempt.attemptId),
        );
        await runtime.rpc(null, "invitation.attach_auth", {
          attemptId: attempt.attemptId,
          authLeaseId: attempt.authLeaseId,
          authUserId: link.userId,
          tokenType: link.type,
          envelope,
        });
        return json({ ok: true });
      }
      const authorization = request.headers.get("authorization");
      const user = authorization?.startsWith("Bearer ")
        ? await runtime.getUser(authorization.slice(7))
        : null;
      if (!user) {
        return json(
          { error: "Please sign in again", code: "unauthorized" },
          401,
        );
      }
      const mapping =
        mappings[endpoint]?.[
          typeof body.operation === "string" ? body.operation : "default"
        ];
      if (!mapping) throw Error("invalid_request");
      if (requiresStepUp(mapping.action)) await requireOperatorStepUp(user);
      const input = pick(body, mapping.fields);
      if (mapping.action === "invitations.preview") {
        const invite = row(await runtime.rpc(user.id, mapping.action, input));
        const message = invitationEmail(
          {
            kind: String(invite.kind),
            recipient_name: String(invite.recipient_name),
            inviter_name: String(invite.inviter_name),
            practice_name: String(invite.practice_name),
          },
          "INVITATION_LINK",
          trustConfig(runtime.env),
        );
        return json({
          subject: message.subject,
          text: message.text.replaceAll(
            new URL(
              "/join#invite=INVITATION_LINK",
              runtime.env.APP_URL,
            ).toString(),
            "[secure invitation link]",
          ),
        });
      }
      if (
        mapping.action === "invitations.create" ||
        mapping.action === "invitations.resend" ||
        mapping.action === "growth.invite"
      ) {
        if (
          !runtime.env.INVITATION_ENCRYPTION_KEY ||
          !runtime.env.INVITATION_KEY_ID
        )
          throw Error("sender_configuration");
        const token = newInvitationToken();
        const tokenHash = await hashToken(token);
        Object.assign(input, {
          tokenHash,
          keyId: runtime.env.INVITATION_KEY_ID,
          envelope: await seal(
            { token },
            runtime.env.INVITATION_ENCRYPTION_KEY,
            runtime.env.INVITATION_KEY_ID,
            tokenHash,
          ),
        });
      }
      if (mapping.action === "application.submit") {
        const config = trustConfig(runtime.env);
        if (
          body.termsVersion !== config.termsVersion ||
          body.privacyVersion !== config.privacyVersion
        )
          throw Error("terms_changed");
      }
      const data = await runtime.rpc(user.id, mapping.action, input);
      if (
        ["invitation.claim", "review.decide", "growth.reconfirm"].includes(
          mapping.action,
        )
      ) {
        // The first transaction has committed. A failed bounded release check
        // is safely retried by the existing dispatch worker; no patient data is
        // granted by this best-effort wake-up or by the client response.
        try {
          await runtime.rpc(null, "growth.sweep", {});
        } catch {
          /* Remains private until the worker retries. */
        }
      }
      if (mapping.action === "application.load") {
        return json({
          ...row(data),
          current_terms_version: runtime.env.TERMS_VERSION ?? null,
          current_privacy_version: runtime.env.PRIVACY_VERSION ?? null,
          current_terms_url: runtime.env.TERMS_URL ?? null,
          current_privacy_url: runtime.env.PRIVACY_URL ?? null,
        });
      }
      return json(data);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error && "message" in error
            ? String(error.message)
            : "request_failed";
      const code =
        message.match(
          /\b(denied|step_up_required|verified_owner_required|last_owner|conflict|rate_limited|invitation_unavailable|recipient_suppressed|reviewed_identity_required|consent_required|credential_policy_required|evidence_required|invalid_profile|invalid_draft|recipient_ineligible|terms_changed|sender_configuration|body_too_large|invalid_request|invalid_cursor|geography_unavailable)\b/,
        )?.[1] ?? "request_failed";
      const status =
        code === "body_too_large"
          ? 413
          : code === "rate_limited"
            ? 429
            : code === "conflict" || code === "terms_changed"
              ? 409
              : code === "sender_configuration"
                ? 503
                : code === "denied" ||
                    code === "step_up_required" ||
                    code === "reviewed_identity_required" ||
                    code === "recipient_suppressed"
                  ? 403
                  : code === "invitation_unavailable"
                    ? 410
                    : 400;
      if (status === 429) headers["retry-after"] = "60";
      const messages: Record<string, string> = {
        step_up_required:
          "Verify your authenticator in Account security before this action. Your edits are retained.",
        verified_owner_required:
          "Use an existing account with a verified email address for the practice owner.",
        last_owner:
          "Another independently reviewed owner is required before removing the last active owner.",
        invalid_cursor:
          "This page no longer matches your filters. Return to the first page.",
        geography_unavailable:
          "Distance filtering is not configured. Browse by suburb or appointment format.",
        credential_policy_required:
          "This profession needs an approved verification and review policy before activation.",
        conflict: "This record changed. Refresh and review the latest version.",
        terms_changed:
          "The terms or privacy notice changed. Reload and review them before continuing.",
        sender_configuration: "Invitation delivery is not configured yet.",
        reviewed_identity_required:
          "ReturnWell needs to review your inviter identity before you can invite someone.",
        rate_limited: "Please wait before trying again.",
        invitation_unavailable: "This invitation is no longer available.",
        evidence_required:
          "Complete the independent identity and registration checks.",
        invalid_profile: "Please check the profile details.",
        invalid_draft:
          "Please check the referral fields. Your edits are retained.",
        recipient_ineligible:
          "This practitioner no longer meets the referral requirements. Review your selection.",
        consent_required: "Please confirm the required consent.",
        recipient_suppressed:
          "Invitations to this address are paused. Contact ReturnWell support.",
      };
      return json(
        {
          error:
            messages[code] ??
            "The request could not be completed. Check your access and details.",
          code,
        },
        status,
      );
    }
  };
}
