# Profession catalogue and activation boundary

Reviewed against the research taxonomy on 2026-10-01: all 34 IDs have a scope
decision in shared/professions.json. This file contains no practitioners or contacts.

Sources checked: [AHPRA professions and divisions](https://www.ahpra.gov.au/Registration/Registers-of-Practitioners/Professions-and-Divisions.aspx)
(search index available; direct page returned 403), [AHPA professions](https://www.ahpa.com.au/allied-health-professions)
and [AHPA member organisations](https://www.ahpa.com.au/member-organisations).
AHPA membership is not itself evidence of an individual's credential.

## Decisions

- Physiotherapy and psychology retain the existing supported product scope.
  Every person still needs the existing independent identity/registration review.
  New credential freshness rules must be deployed before pilot use.
- Other AHPRA-route categories are review_required. The catalogue identifies the
  relevant board family but does not approve conditions, endorsements or divisions.
  Radiography, radiation therapy and nuclear medicine need division-specific
  evidence; a broad medical-radiation credential alone must not activate all three.
- Exercise physiology, speech pathology, dietetics, audiology, social work,
  genetic and rehabilitation counselling, counselling, psychotherapy, orthoptics,
  orthotics, prosthetics, pedorthics, arts/music/child-life/diversional therapy,
  sonography and cardiac physiology are review_required. Their authorityId remains
  protocol_pending until the exact certification route and authority are reviewed.
  Do not require a fabricated AHPRA number or treat similar titles as interchangeable.
- Nutritionist, sexual-assault-worker and welfare-worker categories are out_of_scope
  for this pilot: the research title alone does not identify an approved clinical
  credential and referral scope. No source record is deleted or relabelled.

## Required evidence before enabling any new category

Each profession needs a named clinical reviewer to approve the exact authority,
permitted title/division and referral scope; independent identity verification
against the account; authority-backed credential lookup; evidence reference,
check date, expiry and a positive review interval. Self-review is prohibited.
Renewal/conditions changes and explicit access suspension need documented handling.
No interval or approval is inferred from a website, mailbox confirmation or scraper.

The catalogue is a display/validation contract, not an activation authority.
Database policy and independently reviewed credentials remain authoritative.
Unknown historical values display as unsupported rather than defaulting to psychology.
Funding terms describe provider-supported pathways, not guaranteed rebates.
Language aliases do not guess that “Chinese” means Mandarin or Cantonese.
