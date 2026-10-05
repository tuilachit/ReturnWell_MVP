import assert from "node:assert/strict";
export async function accountRegistrationChecks(t, { sql, rpc, id }) {
  const doctor = id(970001),
    receiver = id(970002),
    unverified = id(970003),
    request = id(970010);
  sql(
    `insert into auth.users(id,email,email_confirmed_at) values ('${doctor}','self-doctor@example.test',now()),('${receiver}','self-receiver@example.test',now()),('${unverified}','unverified-self@example.test',null)`,
  );
  const notices = {
    currentTermsVersion: "test-terms-v1",
    currentPrivacyVersion: "test-privacy-v1",
    termsVersion: "test-terms-v1",
    privacyVersion: "test-privacy-v1",
    consentConfirmed: true,
  };
  await t.test(
    "doctor self-entry creates only their new practice and replays without fabricated verification",
    () => {
      const input = {
        ...notices,
        role: "doctor",
        displayName: "Fictional self Doctor",
        practiceName: "Fictional self Practice",
        registrationNumber: "MED-FIXTURE",
        requestId: request,
        organisationId: id(1),
        operator: true,
      };
      const result = rpc(doctor, "account.register", input);
      assert.ok(result.organisationId);
      assert.deepEqual(rpc(doctor, "account.register", input), result);
      const access = rpc(doctor, "workspace.access");
      assert.equal(access.doctors.length, 1);
      assert.equal(access.doctors[0].organisationId, result.organisationId);
      assert.equal(access.operator, false);
      assert.equal(
        sql(
          `select count(*) from private.inviter_identities where user_id='${doctor}'`,
        ),
        "0",
      );
      assert.equal(
        sql(
          `select count(*) from private.professional_credentials where owner_user_id='${doctor}'`,
        ),
        "0",
      );
      assert.throws(
        () =>
          rpc(doctor, "account.register", { ...input, requestId: id(970011) }),
        /conflict/,
      );
      assert.throws(
        () =>
          rpc(doctor, "account.register", {
            ...input,
            practiceName: "changed",
          }),
        /conflict/,
      );
    },
  );
  await t.test(
    "practitioner self-entry opens a private draft and retains owner isolation",
    () => {
      const input = {
        ...notices,
        role: "practitioner",
        displayName: "Fictional self Receiver",
        requestId: id(970012),
      };
      const created = rpc(receiver, "account.register", input);
      assert.ok(created.applicationId);
      assert.deepEqual(rpc(receiver, "account.register", input), created);
      const access = rpc(receiver, "workspace.access");
      assert.equal(access.applicationId, created.applicationId);
      assert.equal(access.doctors.length, 0);
      assert.equal(access.practitioners.length, 0);
      assert.equal(access.operator, false);
      assert.equal(
        rpc(receiver, "application.load", {
          applicationId: created.applicationId,
        }).status,
        "draft",
      );
      assert.throws(
        () =>
          rpc(doctor, "application.load", {
            applicationId: created.applicationId,
          }),
        /denied/,
      );
    },
  );
  await t.test(
    "unverified mailboxes, forged roles, stale notices and absent consent cannot register",
    () => {
      const input = {
        ...notices,
        role: "doctor",
        displayName: "Fictional invalid Doctor",
        practiceName: "Fictional practice",
        registrationNumber: "MED-FIXTURE",
        requestId: id(970013),
      };
      assert.throws(() => rpc(unverified, "account.register", input), /denied/);
      assert.throws(() => rpc(unverified, "account.status"), /denied/);
      assert.throws(
        () => rpc(receiver, "account.register", { ...input, role: "operator" }),
        /invalid_request/,
      );
      assert.throws(
        () =>
          rpc(receiver, "account.register", { ...input, termsVersion: "old" }),
        /terms_changed/,
      );
      assert.throws(
        () =>
          rpc(receiver, "account.register", {
            ...input,
            consentConfirmed: false,
          }),
        /consent_required/,
      );
      for (const role of ["anon", "authenticated"])
        assert.throws(
          () =>
            sql(`set role ${role};select * from private.account_registrations`),
          /permission denied/,
        );
    },
  );
}
