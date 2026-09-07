# Active implementation contract (7 September 2026)

User authorised all three phases. Root owns database/Edge Functions; UI worker owns app files. Preserve the initial uncommitted repository; no commits, hosted changes or email sends.

Ruling: retain the existing checkout because it has no HEAD and all prior work is uncommitted. Separate file ownership instead of creating a worktree from an absent commit.
Ruling: combine related SQL transactions into one service-only RPC `rw_workflow(p_actor uuid, p_action text, p_input jsonb default '{}')`, internally delegating to named private functions; Edge endpoints remain as specified. This reduces duplicate auth and grant definitions. No browser can call this RPC.

## Frontend contract

All authenticated endpoints are invoked with Supabase `functions.invoke(name,{body:{operation,...input}})`. Error bodies are `{error:string,code?:string}`; successful bodies are raw JSON as below (no extra data wrapper). Browser never supplies actorId. SQL snake_case rows are deliberately returned as rows except workspace-access.

- `workspace-access`: `{doctors:[{organisationId,organisationName,displayName,role}],practitioners:[{practitionerId,displayName,acceptingNewReferrals}],applicationId:string|null,operator:boolean,invitationOrganisations:[{organisationId,organisationName}]}`. Invitation organisations come from separately reviewed operator identities and do not confer clinical membership.
- `manage-invitations`: operation `list` with organisationId nullable -> `{invitations:[{id,kind,recipient_name,recipient_email,status,expires_at,version,signup_completed_at}],inviter:{displayName,practiceName}|null}`. `create` fields from spec -> invitation row (email queue state may be `paused_configuration`). `resend/revoke` fields from spec -> invitation row. Cannot expose tokens in success responses.
- `invitation-entry` is unauthenticated. POST fetch with publishable `apikey` header, body `{operation:'inspect',token}` -> `{invitationId,inviterName,practiceName,recipientName,maskedEmail,kind,expiresAt,termsVersion,privacyVersion,websiteUrl,privacyUrl,termsUrl,supportEmail,businessName}`. `beginSignup` with token, termsVersion, privacyVersion, consentAccepted=true, requestId -> `{ok:true}`. `decline` -> `{ok:true}`.
- Auth verification URL `/auth/confirm#token_hash=...&type=invite|magiclink&invitationId=UUID&attemptId=UUID`. Read fragment only, show explicit Verify and continue button, call `client.auth.verifyOtp` only after click. Then `claim-invitation` body `{invitationId,attemptId,displayName,requestId}` -> `{ok:true,applicationId?,organisationId?}`. Name input can be collected on this page. Clear fragment after success. Different signed-in account requires explicit sign-out first.
- `practitioner-onboarding`: `load {applicationId}` -> application row `{id,user_id,status,version,profile,applicant_feedback,practitioner_id,...}`. `profile` uses camelCase fields from spec. `save/submit/availability` same fields as spec -> application row (availability -> `{ok:true}`).
- `review-practitioner`: `list` -> `{applications:[application rows]}`; `detail {applicationId}` -> `{application:row,reviews:[review rows]}`. `decide` fields as spec -> application row. Feedback field `applicantFeedback`, evidence fields `{method,matched,reference,checkedAt}` and registration evidence also `registrationNumber`.
- `respond-to-referral`: `{referralId,expectedVersion,decision,reasonCode?,note?,requestId}` -> `{referralId,status,version,updatedAt,notification:'pending'|'configuration_needed'|'suppressed'}`.
- Referral lists/detail/events use existing client RLS tables `referrals`, `referral_events`, `practitioners`; version added to referrals. Assigned-only listing uses `selected_practitioner_id`. Timeline `details` includes `reasonCode`/`note` only for decline. Clinical attributes stay out of notifications.

App routing: AuthGate accepts optional requested workspace type or uses window pathname. Existing doctor deep links preserved. Add /invitations, /onboarding, /admin/practitioners, /practitioner, /join, /auth/confirm. Authenticated app navigation can be ordinary links. Existing preview remains empty and explicit demo. Add meaningful demo preview for new workflows only if clearly local and explicitly selected, never claim sends in demo.

## Ownership and progress

- Root: SQL, server helpers/Edge Functions, integration testing, documentation.
- UI worker: app/**, UI tests as needed; no package/SQL edits.
- First review: UI contract and safety; final review: SQL/API authorisation and cross-layer behaviour.
- All three phases implemented locally. See [implementation evidence](implementation-report.md) and the [release runbook](launch-runbook.md) for verified scope and remaining deployment gates.
