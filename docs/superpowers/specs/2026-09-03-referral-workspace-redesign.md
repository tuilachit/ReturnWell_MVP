# ReturnWell Referral Workspace Redesign

## Objective

Restyle the existing fictional GP referral prototype using the supplied measurement-workspace screenshot as a visual reference without copying its product content. Preserve every working referral interaction and make the dashboard feel like a restrained operational tool used repeatedly during a GP's day.

## Approved direction

- Use a fixed white desktop sidebar with ReturnWell branding, a black `New referral` action, referral search, and only working ReturnWell destinations.
- Use a soft-grey main workspace with broad panels, dense rows, restrained corner rounding, black primary actions, and minimal decorative colour.
- Consolidate referral totals into one summary band.
- Group referrals into `Needs attention`, `In progress`, and `Completed` sections.
- Carry the same shell through the new-referral wizard and referral detail view.
- Collapse the sidebar into a compact top section on smaller screens.

## Functional constraints

- Preserve referral creation, practitioner selection, patient choice, consent, sending simulation, referral detail, and fallback actions.
- Preserve the fictional-data and non-transmission warnings.
- Do not introduce placeholder navigation, external integrations, or real patient data.
- Do not change the existing Open Graph image or product metadata because the ReturnWell identity is unchanged.
- Keep keyboard focus states, form labels, native controls, and responsive layouts usable.

## Visual language

- Neutral palette: white, warm light grey, charcoal, and muted grey text.
- Reserve colour for status dots, warnings, selection state, and focus state.
- Prefer one level of broad panel grouping over nested cards.
- Use compact typography and row density suitable for an operational dashboard.
- Avoid gradients, oversized marketing headings, floating glass panels, excessive pills, and non-functional decoration.

## Acceptance criteria

1. The initial rendered page includes the persistent referral sidebar and black `New referral` action.
2. The dashboard renders one summary band and three referral groups.
3. Referral search and status filtering still filter the rendered referral list.
4. Existing new-referral, shortlist, review, sent, and detail interactions remain available.
5. The prototype safety wording and social metadata remain present.
6. Build, rendered HTML tests, and lint complete successfully.
