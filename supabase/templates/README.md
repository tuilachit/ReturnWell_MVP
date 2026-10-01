# Auth template candidate — NOT enabled

`magic-link.html` is the returning-user Supabase Auth SMTP template candidate. It is deliberately not referenced by config.toml or installed remotely. Replace the two explicit business/support markers only with independently approved values, review the exact hosted Auth expiry, and approve the resulting template before C5. Do not invent a duration: Auth template variables do not include a per-message expiry timestamp.

The separate application invitation/verification emails use the shared layout and server-stored exact deadlines, not this template. They keep the deliberate passive confirmation page. This Auth template uses Supabase's existing ConfirmationURL flow; actual mailbox security-link scanner behavior and returning-user deep-link acceptance are still a C5 gate, not proven by a web preview.

`magic-link.txt` records the equivalent plain-text purpose for review. Supabase's documented template setting is HTML; inspect the actual SMTP MIME/text alternative during C5 rather than assuming this file is automatically used. Neither candidate is installed by this repository.

Documented variables: [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates) (`ConfirmationURL`, `SiteURL`). No user metadata, clinical content or marketing fields. Provider open/click tracking must be disabled and verified for credential mail in C5; local HTML contains no trackers, but that does not prove provider-side settings.
