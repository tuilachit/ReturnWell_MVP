import { buildNotification, type NotificationKind } from "./email.ts";
import {
  type Row,
  row,
  trustConfig,
  type WorkflowRuntime,
} from "./workflow-http.ts";
import {
  type Envelope,
  invitationEmail,
  seal,
  type TrustConfig,
  unseal,
} from "./workflow-security.ts";
type Transport = (payload: Row, idempotencyKey: string) => Promise<Response>;
type DispatchRuntime = Pick<WorkflowRuntime, "env" | "rpc">;
export async function dispatchJobs(
  runtime: DispatchRuntime,
  limit: number,
  send: Transport,
) {
  const { env } = runtime;
  let config: TrustConfig | undefined;
  try {
    config = trustConfig(env);
  } catch { /* Missing trust configuration keeps delivery paused. */ }
  const configured = env.EMAIL_DELIVERY_ENABLED === "true" &&
    Boolean(
      config && env.RESEND_API_KEY && env.RESEND_FROM &&
        env.INVITATION_ENCRYPTION_KEY && env.INVITATION_KEY_ID,
    );
  const jobs = await runtime.rpc(null, "email.claim", {
    configured,
    limit,
  }) as Row[];
  if (!configured || !config) {
    return { processed: 0, configurationNeeded: true };
  }
  const secret = env.INVITATION_ENCRYPTION_KEY!;
  const keyId = env.INVITATION_KEY_ID!;
  const decrypt = async (envelope: unknown, context: string) => {
    const typed = envelope as Envelope;
    // Prior keys stay server-only until in-flight jobs expire during rotation.
    const keys: Record<string, string> = JSON.parse(
      env.INVITATION_PREVIOUS_KEYS ?? "{}",
    );
    const selected = typed.keyId === keyId ? secret : keys[typed.keyId];
    if (!selected) throw Error("encryption_configuration");
    return row(await unseal(typed, selected, context));
  };
  const results = await Promise.all(jobs.map(async (job) => {
    const identity = { jobId: job.id, leaseId: job.lease_id };
    let started = false;
    try {
      const allowlist = env.EMAIL_TEST_ALLOWLIST?.split(",").map((x) =>
        x.trim().toLowerCase()
      ).filter(Boolean);
      if (
        allowlist?.length &&
        !allowlist.includes(String(job.recipient_email).toLowerCase())
      ) {
        await runtime.rpc(null, "email.finish", {
          ...identity,
          outcome: "paused_configuration",
        });
        return "paused";
      }
      let payload: Row;
      if (job.prepared_payload) {
        payload = await decrypt(job.prepared_payload, String(job.id));
      } else {
        const data = row(job.payload);
        let message: { subject: string; text: string; html?: string };
        if (job.family === "referral") {
          message = buildNotification({
            id: String(job.id),
            referralId: String(data.referralId),
            kind: String(data.kind) as NotificationKind,
            recipientEmail: String(job.recipient_email),
            idempotencyKey: String(job.idempotency_key),
            templateData: {},
          }, config!.appUrl);
        } else if (job.family === "invitation") {
          const { token } = await decrypt(data.envelope, String(data.context));
          const invite = row(data.invitation);
          message = invitationEmail(
            {
              kind: String(invite.kind),
              recipient_name: String(invite.recipient_name),
              inviter_name: String(invite.inviter_name),
              practice_name: String(invite.practice_name),
            },
            String(token),
            config!,
          );
        } else {
          const decrypted = await decrypt(data.envelope, String(data.context));
          message = {
            subject: String(decrypted.subject),
            text: String(decrypted.text),
          };
        }
        payload = {
          from: env.RESEND_FROM,
          to: [job.recipient_email],
          subject: message.subject.replaceAll(/[\r\n]/g, " "),
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        };
        await runtime.rpc(null, "email.prepare", {
          ...identity,
          envelope: await seal(payload, secret, keyId, String(job.id)),
        });
      }
      await runtime.rpc(null, "email.start", identity);
      started = true;
      const response = await send(payload, String(job.idempotency_key));
      if (response.ok) {
        const body = row(await response.json());
        if (typeof body.id !== "string" || !body.id) {
          throw Error("ambiguous_provider_response");
        }
        await runtime.rpc(null, "email.finish", {
          ...identity,
          outcome: "sent",
          providerId: body.id,
        });
        return "sent";
      }
      await runtime.rpc(null, "email.finish", {
        ...identity,
        outcome: response.status === 429 || response.status >= 500
          ? "transient"
          : "permanent",
      });
      return "failed";
    } catch {
      // A timeout may already have delivered. Keep the same payload/key and
      // never log the recipient, credential or provider response body.
      try {
        await runtime.rpc(null, "email.finish", {
          ...identity,
          outcome: started ? "transient" : "paused_configuration",
        });
      } catch { /* A revoked/expired lease cannot be completed here. */ }
      return started ? "uncertain" : "paused";
    }
  }));
  return {
    processed: jobs.length,
    sent: results.filter((x) => x === "sent").length,
    configurationNeeded: results.includes("paused"),
  };
}
