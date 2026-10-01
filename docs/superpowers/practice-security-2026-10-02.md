# Practice administration and privileged MFA — local implementation

This is not a hosted release or approval for real referrals. The original checkout is unchanged.

## Implemented boundary

- `/admin/practices` is an operator workspace for bounded practice/member metadata, independent owner/contact/inviter checks and audited membership revocation. It does not return clinical records. Browser-supplied roles/actors are ignored.
- Creating a practice requires an existing email-verified owner account and independent evidence. It grants only `owner` in that practice, never platform-operator status. This UI cannot promote arbitrary members to owner/admin.
- A reviewed contact is stored separately from profiles and scraped data. Changing it requires a new independent check and the current practice version. Inviter branding is a reviewed snapshot, unaffected by a user's display-name changes.
- Revocation uses the member version, retains records, disables membership and inviter identity, and revokes pending invitations from that member in the practice. Another independently reviewed active owner must exist before an owner can be removed.
- Credential decisions, suspension/restoration and practice mutations require AAL2. The shared runtime uses provider-verified `getUser` and `getClaims`, checks matching subjects and current verified factors, and returns only the trusted identity/assurance. Current role and independent-review checks still happen in SQL. AAL2 is not a role.
- `/security` supports real TOTP enrollment, challenge/verification and disposal of incomplete setups. The QR/key stays in component memory; it is not saved to app storage, logs, analytics or a URL. The Auth SDK still stores its normal session. Removing a verified factor or account recovery is not implemented as an operator shortcut.
- Admin mutations retain the request ID across an uncertain result. Known rejections retain the form; conflicts require review of the saved version. MFA can be completed in another tab without abandoning the current form.

The flow follows the current [Supabase TOTP guide](https://supabase.com/docs/guides/auth/auth-mfa/totp) and [verified claims API](https://supabase.com/docs/reference/javascript/auth-getclaims). Changelog reviewed before this package; no dependency/provider migration was performed.

## Evidence and remaining gates

Local tests include real Auth TOTP, tampered JWT rejection, AAL1 denial, AAL2 success, revoked-operator denial using the same session, direct privileged RPC denial, independent review, contact isolation and last-owner protection. SQL is separately tested from a clean sorted migration set. Browser tests use the shared production HTTP handler against local Auth/PostgREST, not the hosted Deno runtime or real email.

Supabase local database lint returned no errors. Local iteration used direct SQL; the persistent development stack's migration table contains older seed history and is **not** a canonical migration rehearsal. Clean sorted disposable database tests are the migration-compatibility evidence so far. A clean Supabase restore/migration rehearsal remains D6.

Full D3 is unfinished: public-origin abuse controls, session/recovery acceptance, response-header verification, historical exposed-key rotation and hosted security advisors remain separate work/gates. No hosted configuration, secret, MFA policy, role, email or deployment was changed. Operator recovery and initial operator provisioning need an approved support procedure before a pilot.
