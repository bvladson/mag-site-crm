import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "mag-admin-security-"));
process.env.SITE_DATA_DIR = directory;
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const mfa = await import("../src/lib/mfa.server.ts");
const units = await import("../src/lib/units.server.ts");
const audit = await import("../src/lib/administration.server.ts");
const password = "Senha-Temporaria-123";
const makeUser = async (name, roles = ["admin"]) => ({
  id: (await auth.createUser(`${name}@example.invalid`, password, roles)).id,
  email: `${name}@example.invalid`,
  roles,
  created_at: "",
});
const admin = await makeUser("administration"),
  commercial = await makeUser("commercial", ["comercial"]),
  disabled = await makeUser("disabled");
db.getDb().prepare("UPDATE users SET disabled=1 WHERE id=?").run(disabled.id);
test.after(async () => {
  db.closeDb();
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("RFC6238 official SHA1/SHA256/SHA512 test vectors, 64-bit times and six-digit truncation", () => {
  // RFC6238 Appendix B, https://www.rfc-editor.org/rfc/rfc6238
  const vectors = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];
  const secrets = [
    "12345678901234567890",
    "12345678901234567890123456789012",
    "1234567890123456789012345678901234567890123456789012345678901234",
  ].map((s) => mfa.base32(Buffer.from(s)));
  for (const [time, ...expected] of vectors)
    for (let i = 0; i < 3; i++)
      assert.equal(
        mfa.totpAt(secrets[i], time * 1000, 8, ["sha1", "sha256", "sha512"][i]),
        expected[i],
      );
  assert.equal(mfa.totpAt(secrets[0], 59000), "287082");
});

test("setup requires password, encrypts secret and only enables after a real code", async () => {
  await assert.rejects(() => mfa.beginMfaSetup(null, password), /Unauthorized/);
  await assert.rejects(() => mfa.beginMfaSetup(disabled, password), /Unauthorized/);
  await assert.rejects(() => mfa.beginMfaSetup(admin, "wrong"), /Senha/);
  const time = 1792152000000;
  const setup = await mfa.beginMfaSetup(admin, password, time);
  assert.equal(mfa.mfaStatus(admin).enabled, false);
  assert.match(setup.uri, /^otpauth:\/\/totp\//);
  const stored = db.getDb().prepare("SELECT * FROM user_mfa WHERE user_id=?").get(admin.id);
  assert.ok(!stored.pending_secret.includes(setup.secret));
  assert.match(stored.pending_secret, /^v1\./);
  assert.equal((await readFile(join(directory, "security", "mfa.key"))).length, 32);
  if (process.platform !== "win32") {
    assert.equal((await stat(join(directory, "security"))).mode & 0o777, 0o700);
    assert.equal((await stat(join(directory, "security", "mfa.key"))).mode & 0o777, 0o600);
  }
  assert.throws(() => mfa.confirmMfaSetup(admin, "broken", undefined, time), /Código/);
  const session = auth.createSession(admin.id, time);
  const tokenHash = auth.tokenHash(session);
  const secondSession = auth.createSession(admin.id, time + 1);
  const result = mfa.confirmMfaSetup(admin, mfa.totpAt(setup.secret, time), tokenHash, time);
  assert.equal(result.recoveryCodes.length, 8);
  assert.equal(mfa.mfaStatus(admin).enabled, true);
  assert.ok(auth.sessionUser(session, time + 2));
  assert.equal(auth.sessionUser(secondSession, time + 2), null);
  assert.throws(() => auth.createSession(admin.id, time), /duas etapas/);
  assert.equal(mfa.verifyMfaLogin(admin, undefined, time), false);
  assert.throws(() => mfa.verifyMfaLogin(admin, mfa.totpAt(setup.secret, time), time), /Código/);
  const next = time + 30000;
  assert.equal(mfa.verifyMfaLogin(admin, mfa.totpAt(setup.secret, next), next), true);
  assert.throws(() => mfa.verifyMfaLogin(admin, mfa.totpAt(setup.secret, next), next), /Código/);
  const accepted = auth.createSession(admin.id, next, true);
  assert.ok(auth.sessionUser(accepted, next));
  const after = db.getDb().prepare("SELECT * FROM user_mfa WHERE user_id=?").get(admin.id);
  for (const c of result.recoveryCodes) assert.ok(!after.recovery_hashes.includes(c));
  assert.equal(mfa.verifyMfaLogin(admin, result.recoveryCodes[0], next), true);
  assert.throws(() => mfa.verifyMfaLogin(admin, result.recoveryCodes[0], next), /Código/);
  assert.equal(mfa.mfaStatus(admin).recoveryRemaining, 7);
  await assert.rejects(
    () => mfa.disableMfa(admin, "wrong", result.recoveryCodes[1], tokenHash, next),
    /Senha/,
  );
  await mfa.disableMfa(admin, password, result.recoveryCodes[1], tokenHash, next);
  assert.equal(mfa.mfaStatus(admin).enabled, false);
  assert.ok(auth.sessionUser(session, next));
});

test("five wrong MFA codes persist a 15-minute lock, then valid next-step code is accepted", async () => {
  const user = await makeUser("mfa-rate");
  const time = 1792152000000;
  const setup = await mfa.beginMfaSetup(user, password, time);
  mfa.confirmMfaSetup(user, mfa.totpAt(setup.secret, time), undefined, time);
  for (let i = 0; i < 4; i++)
    assert.throws(() => mfa.verifyMfaLogin(user, "broken", time + 30000), /Código/);
  assert.throws(() => mfa.verifyMfaLogin(user, "broken", time + 30000), /Muitas tentativas/);
  assert.throws(
    () => mfa.verifyMfaLogin(user, mfa.totpAt(setup.secret, time + 60000), time + 60000),
    /Muitas tentativas/,
  );
  const later = time + 31 * 30000;
  assert.equal(mfa.verifyMfaLogin(user, mfa.totpAt(setup.secret, later), later), true);
});

test("expired setup cannot enable MFA and disabled/revoked actors cannot inspect security", async () => {
  const user = await makeUser("mfa-expiry");
  const now = Date.now();
  const setup = await mfa.beginMfaSetup(user, password, now);
  assert.throws(
    () =>
      mfa.confirmMfaSetup(user, mfa.totpAt(setup.secret, now + 600001), undefined, now + 600001),
    /Código/,
  );
  assert.throws(() => mfa.mfaStatus(disabled), /Unauthorized/);
  assert.throws(() => mfa.teamMfaStatus({ ...commercial, roles: ["admin"] }), /Forbidden/);
});

test("recovery renewal invalidates the old set and disabling requires both password and an unused code", async () => {
  const user = await makeUser("mfa-renewal");
  const time = 1792152000000;
  const setup = await mfa.beginMfaSetup(user, password, time);
  const first = mfa.confirmMfaSetup(user, mfa.totpAt(setup.secret, time), undefined, time);
  await assert.rejects(
    () => mfa.disableMfa(user, password, "broken", undefined, time + 30000),
    /Código/,
  );
  assert.equal(mfa.mfaStatus(user).enabled, true);
  const second = await mfa.regenerateMfaRecovery(
    user,
    password,
    first.recoveryCodes[0],
    time + 30000,
  );
  assert.equal(second.recoveryCodes.length, 8);
  assert.throws(() => mfa.verifyMfaLogin(user, first.recoveryCodes[1], time + 30000), /Código/);
  assert.equal(mfa.verifyMfaLogin(user, second.recoveryCodes[0], time + 30000), true);
  await assert.rejects(
    () => mfa.disableMfa(user, password, second.recoveryCodes[0], undefined, time + 30000),
    /Código/,
  );
  assert.equal(mfa.mfaStatus(user).enabled, true);
  await mfa.disableMfa(user, password, second.recoveryCodes[1], undefined, time + 30000);
  assert.equal(mfa.mfaStatus(user).enabled, false);
});

test("session management is scoped to its owner and never revokes the current session by mistake", () => {
  const now = Date.now();
  const mine = auth.createSession(commercial.id, now),
    other = auth.createSession(commercial.id, now + 1),
    adminToken = auth.createSession(admin.id, now);
  const mineHash = auth.tokenHash(mine),
    otherHash = auth.tokenHash(other),
    adminHash = auth.tokenHash(adminToken);
  const list = mfa.ownSessions(commercial, mineHash);
  assert.equal(list.find((s) => s.id === mineHash).current, true);
  assert.ok(!list.some((s) => s.id === adminHash));
  assert.throws(() => mfa.revokeSession(commercial, adminHash, mineHash), /não encontrada/);
  assert.throws(() => mfa.revokeSession(commercial, mineHash, mineHash), /Use Sair/);
  mfa.revokeSession(commercial, otherHash, mineHash);
  assert.equal(auth.sessionUser(other, now + 2), null);
  assert.ok(auth.sessionUser(mine, now + 2));
  assert.ok(auth.sessionUser(adminToken, now + 2));
});

test("units preserve published UUIDs/phones, optimistic revisions, history and admin permissions", () => {
  const centroId = crypto.randomUUID(),
    brId = crypto.randomUUID();
  db.getDb().exec(
    "CREATE TABLE IF NOT EXISTS link_tree_publications (id TEXT PRIMARY KEY,version INTEGER,content TEXT)",
  );
  db.getDb()
    .prepare("INSERT INTO link_tree_publications VALUES (?,?,?)")
    .run(
      crypto.randomUUID(),
      1,
      JSON.stringify({
        items: [
          {
            id: centroId,
            type: "location",
            title: "Unidade Centro",
            address: "Av. Dom Manuel, 1180 - Centro, Fortaleza - CE, 60060-091",
            phone: "",
            landline: "8531220506",
            active: true,
          },
          {
            id: brId,
            type: "location",
            title: "Unidade BR-116",
            address: "Travessa Sargento Portugal, 64, Fortaleza",
            phone: "85998610074",
            active: true,
          },
        ],
      }),
    );
  const active = units.listUnitsPublic();
  assert.equal(active.length, 2);
  assert.equal(active.find((u) => u.id === centroId).phone, "558531220506");
  assert.equal(active.find((u) => u.id === brId).whatsapp, "5585998610074");
  for (const user of [null, commercial, disabled, { ...commercial, roles: ["admin"] }])
    assert.throws(() => units.listUnitsAdmin(user), /Unauthorized|Forbidden/);
  const centro = units.getUnit(centroId);
  const changed = units.saveUnit(admin, {
    ...centro,
    hours: "Horário informado pela equipe",
    active: false,
  });
  assert.equal(changed.revision, 2);
  assert.throws(() => units.saveUnit(admin, centro), /outra aba/);
  assert.throws(() => units.validateUnitId(centroId), /inativa/);
  assert.equal(units.getUnit(centroId).active, false);
  assert.equal(
    Number(
      db
        .getDb()
        .prepare("SELECT count(*) AS n FROM site_unit_history WHERE unit_id=?")
        .get(centroId).n,
    ),
    2,
  );
  assert.equal(units.listUnitsPublic().length, 1);
});

test("audit exposes a paginated admin-only log with a strict metadata allowlist", () => {
  db.audit(admin.id, "unit:test", "safe-id", {
    revision: 4,
    payload: "CPF 123.456.789-00",
    email: "private@example.invalid",
    count: 3,
    duration_ms: 20,
    motivo: "private message",
  });
  for (const user of [null, commercial, { ...commercial, roles: ["admin"] }])
    assert.throws(() => audit.listAuditLog(user, { page: 1 }), /Unauthorized|Forbidden/);
  const results = audit.listAuditLog(admin, { page: 1, action: "unit:" });
  const record = results.rows.find((r) => r.action === "unit:test");
  assert.deepEqual(record.details, { revision: 4, count: 3, duration_ms: 20 });
  assert.ok(!JSON.stringify(results).includes("private"));
  assert.throws(() => audit.listAuditLog(admin, { page: 0 }));
  assert.throws(() => audit.listAuditLog(admin, { page: 1, from: "2026-13-40" }));
  db.audit(admin.id, "unit:legacy", "123.456.789-00", { revision: 1 });
  assert.equal(
    audit.listAuditLog(admin, { page: 1, action: "unit:legacy" }).rows[0].targetId,
    null,
  );
});
