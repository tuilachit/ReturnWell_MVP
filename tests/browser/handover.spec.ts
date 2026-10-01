import { test, expect } from "@playwright/test";
import { doctorBrowser } from "../helpers/browser-context.mjs";
import { createReferral } from "../../app/lib/referrals";
import { randomUUID } from "node:crypto";
for (const actor of ["doctor", "practitioner"])
  test(`${actor} sees reviewed external handover details without email patient content`, async ({
    page,
  }) => {
    test.skip(
      !process.env.RW_LOCAL_STACK_DIR,
      "Requires isolated local Supabase",
    );
    const { local, doctor, owner, organisationId, practitionerId } =
      await doctorBrowser(page, { actor });
    const ref = await createReferral(
      doctor.client,
      {
        organisationId,
        organisationName: "Fictional Practice",
        displayName: "Fictional Doctor",
      },
      doctor.userId,
      {
        patientReference: "FICTIONAL-HANDOVER",
        patientPostcode: "2000",
        profession: "physiotherapist",
        clinicalSummary: "Fictional coordination summary.",
        fundingPath: "Medicare",
        appointmentFormat: "telehealth",
        languageOrAccess: "",
        selectionMode: "doctor",
        selectedPractitionerId: practitionerId,
        consentConfirmed: true,
      },
    );
    const accepted = await local.call(
      "respond-to-referral",
      {
        referralId: ref.id,
        expectedVersion: 0,
        decision: "accepted",
        requestId: randomUUID(),
      },
      owner.client,
    );
    expect(accepted.status).toBe(200);
    await page.goto("/referrals/" + ref.id);
    const handover = page.getByRole("region", {
      name: "External handover",
      exact: true,
    });
    await expect(
      handover.getByRole("heading", {
        name: "Arrange external handover",
        exact: true,
      }),
    ).toBeVisible();
    await expect(handover).toContainText("reviewed practice contact");
    local.sql(
      `insert into private.practice_contacts(organisation_id,phone,instructions,evidence_reference,reviewed_by) values ('${organisationId}','02 5555 1212','Call to agree a secure channel. <b>Text only</b> https://secure.example.test/handover','Fictional independent review','${owner.userId}')`,
    );
    await page.reload();
    await expect(
      handover.getByRole("link", { name: "02 5555 1212", exact: true }),
    ).toHaveAttribute("href", "tel:0255551212");
    await expect(
      handover.getByRole("link", {
        name: "https://secure.example.test/handover",
        exact: true,
      }),
    ).toHaveAttribute("rel", "noreferrer noopener");
    expect(await handover.locator('a[href^="mailto:"]').count()).toBe(0);
    await expect(handover).toContainText("<b>Text only</b>");
    expect(await handover.locator("b").count()).toBe(0);
    local.sql(
      `update private.practice_contacts set phone='02 5555 3434' where organisation_id='${organisationId}'`,
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      handover.getByRole("link", { name: "02 5555 3434", exact: true }),
    ).toBeVisible();
    expect(
      local.sql(`select status from public.referrals where id='${ref.id}'`),
    ).toBe("accepted");
  });
