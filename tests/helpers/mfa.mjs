import { createHmac } from "node:crypto";
// RFC 6238 local test utility. Secrets are never printed or saved.
export function totp(secret, time = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw Error("Invalid local fixture secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const key = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
      parseInt(bits.slice(i * 8, i * 8 + 8), 2),
    ),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
export async function enrollFixtureMfa(client) {
  const factor = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Fictional local test only",
  });
  if (factor.error)
    throw Error(`Local MFA enrollment failed: ${factor.error.code}`);
  const verified = await client.auth.mfa.challengeAndVerify({
    factorId: factor.data.id,
    code: totp(factor.data.totp.secret),
  });
  if (verified.error)
    throw Error(`Local MFA verification failed: ${verified.error.code}`);
  return { factorId: factor.data.id, secret: factor.data.totp.secret };
}
