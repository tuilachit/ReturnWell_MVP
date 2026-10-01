# Dependency remediation — local evidence

Baseline audit: 10 findings (2 high, 8 moderate). Updated lockfile has zero
reported npm vulnerabilities as of 2026-10-01. This is not a security certification.

| Dependency | Change | Verification / rationale |
|---|---|---|
| undici | 7.29.0 → pinned override 7.29.1 | Patch fixes BalancedPool custom TLS handling; transitively used by Miniflare. |
| brace-expansion | 1.1.18 → 1.1.21; 5.0.9 → 5.0.12 | Patched transitive versions, no major application upgrade. |
| fast-uri | 3.1.7 → 3.1.8 | Patched transitive version. |
| esbuild inside @esbuild-kit/core-utils | 0.18.20 → scoped override 0.25.12 | Eliminates vulnerable development-server CORS implementation. Drizzle 0.31.10 remains pinned; not downgraded to the obsolete version suggested by audit. |

Clean npm install and Drizzle generation against the seven-table D1 schema
succeeded, with output confined to a new temporary directory. Cloudflare and
Vercel builds are required regression gates for these overrides. No development
server is exposed to the public network. Recheck the overrides when upstream
packages adopt patched versions; do not remove them merely to silence warnings.

Primary advisories:

- https://github.com/nodejs/undici/security/advisories/GHSA-w293-vg96-wgc3
- https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-qhr7-859c-m2p7
- https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99

No hosted configuration or dependencies were changed.
