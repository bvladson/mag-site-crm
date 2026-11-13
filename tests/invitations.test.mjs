import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "mag-invites-"));
process.env.SITE_DATA_DIR = directory;
const db = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const invitations = await import("../src/lib/invitations.server.ts");
const password = "Senha-Forte-Temporaria-123";
const makeUser = async (name, roles = ["admin"]) => ({
  id: (await auth.createUser(`${name}@example.invalid`, password, roles)).id,
  email: `${name}@example.invalid`,
  roles,
  created_at: "",
});
const admin = await makeUser("inviter"),
  commercial = await makeUser("commercial", ["comercial"]);
const tokenOf = (i) => new URLSearchParams(new URL(i.url).hash.slice(1)).get("token");
const create = (name, roles = ["comercial"], now = Date.now()) =>
  invitations.createInvitation(admin, { email: `${name}@example.invalid`, roles }, now);
test.after(async () => {
  db.closeDb();
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("admin invitation token is random, hash-only, fragment-based and expires after 72 hours", () => {
  const now = Date.now(),
    first = create("recipient", ["comercial", "dho"], now),
    second = create("recipient2", ["comercial"], now);
  assert.equal(first.expiresAt - now, 72 * 3600000);
  const token = tokenOf(first);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.notEqual(token, tokenOf(second));
  const url = new URL(first.url);
  assert.equal(url.origin, "https://magmoveiscorporativos.com.br");
  assert.equal(url.search, "");
  const raw = db.getDb().prepare("SELECT * FROM site_invitations WHERE id=?").get(first.id);
  assert.notEqual(raw.token_hash, token);
  assert.ok(!JSON.stringify(raw).includes(token));
  assert.equal(invitations.inspectInvitation(token, now).email, "recipient@example.invalid");
  assert.throws(() => invitations.inspectInvitation(token, now + 72 * 3600000), /inválido/);
  assert.ok(!JSON.stringify(invitations.listInvitations(admin)).includes(token));
  assert.ok(!JSON.stringify(db.getDb().prepare("SELECT * FROM audit_log").all()).includes(token));
});

test("role forgery and existing emails cannot create or promote accounts", async () => {
  for (const actor of [null, commercial, { ...commercial, roles: ["admin"] }])
    assert.throws(
      () =>
        invitations.createInvitation(actor, { email: "forged@example.invalid", roles: ["admin"] }),
      /Unauthorized|Forbidden/,
    );
  assert.throws(
    () =>
      invitations.createInvitation(admin, {
        email: commercial.email.toUpperCase(),
        roles: ["admin"],
      }),
    /Já existe/,
  );
  const i = create("fixed-role"),
    token = tokenOf(i);
  await assert.rejects(
    () => invitations.acceptInvitation({ token, name: "Pessoa", password, roles: ["admin"] }),
    /unrecognized_keys/,
  );
  await assert.rejects(() =>
    invitations.acceptInvitation({ token, name: "Pessoa", password: "fraca" }),
  );
  await invitations.acceptInvitation({ token, name: "Pessoa", password });
  const user = await auth.authenticate("fixed-role@example.invalid", password);
  assert.deepEqual(user.roles, ["comercial"]);
  assert.equal(
    Number(db.getDb().prepare("SELECT count(*) AS n FROM sessions WHERE user_id=?").get(user.id).n),
    0,
  );
  await assert.rejects(
    () => invitations.acceptInvitation({ token, name: "Pessoa", password }),
    /inválido/,
  );
  assert.throws(() => invitations.revokeInvitation(admin, i.id), /já foi aceito/);
  assert.ok(await auth.authenticate("fixed-role@example.invalid", password));
});

test("revoking or replacing pending invitations invalidates their tokens", async () => {
  const first = create("revoked");
  invitations.revokeInvitation(admin, first.id);
  assert.throws(() => invitations.inspectInvitation(tokenOf(first)), /inválido/);
  await assert.rejects(
    () => invitations.acceptInvitation({ token: tokenOf(first), name: "Pessoa", password }),
    /inválido/,
  );
  const old = create("replacement"),
    current = create("replacement");
  assert.throws(() => invitations.inspectInvitation(tokenOf(old)), /inválido/);
  assert.equal(
    invitations.inspectInvitation(tokenOf(current)).email,
    "replacement@example.invalid",
  );
});

test("final transaction rechecks expiry and administrator roles after password hashing", async () => {
  const now = Date.now(),
    expiry = create("expires-during-hash", ["comercial"], now);
  let reads = 0;
  await assert.rejects(
    () =>
      invitations.acceptInvitation({ token: tokenOf(expiry), name: "Pessoa", password }, () =>
        ++reads === 1 ? now : expiry.expiresAt + 1,
      ),
    /inválido/,
  );
  assert.equal(
    db
      .getDb()
      .prepare("SELECT 1 FROM users WHERE email=?")
      .get("expires-during-hash@example.invalid"),
    undefined,
  );
  const i = create("creator-demoted");
  const accepting = invitations.acceptInvitation({ token: tokenOf(i), name: "Pessoa", password });
  db.getDb().prepare("UPDATE users SET roles='[\"comercial\"]' WHERE id=?").run(admin.id);
  await assert.rejects(() => accepting, /inválido/);
  db.getDb().prepare("UPDATE users SET roles='[\"admin\"]' WHERE id=?").run(admin.id);
  assert.equal(
    db.getDb().prepare("SELECT 1 FROM users WHERE email=?").get("creator-demoted@example.invalid"),
    undefined,
  );
});

test("a concurrently created email is never overwritten or promoted", async () => {
  const i = create("race-email");
  await auth.createUser("race-email@example.invalid", password, ["dho"]);
  await assert.rejects(
    () => invitations.acceptInvitation({ token: tokenOf(i), name: "Pessoa", password }),
    /Já existe/,
  );
  assert.deepEqual((await auth.authenticate("race-email@example.invalid", password)).roles, [
    "dho",
  ]);
});
