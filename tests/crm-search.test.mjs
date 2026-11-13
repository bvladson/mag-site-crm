import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "mag-crm-search-"));
process.env.SITE_DATA_DIR = directory;
process.env.CRM_DISABLE_WORKER = "1";
const database = await import("../src/lib/local-db.server.ts");
const auth = await import("../src/lib/local-auth-core.server.ts");
const crm = await import("../src/lib/crm.server.ts");
const units = await import("../src/lib/units.server.ts");
const db = () => database.getDb();
const actor = async (label, roles = ["comercial"]) => {
  const email = `${label}@search.example.invalid`;
  return { id: (await auth.createUser(email, "QA-Strong-Password-123", roles)).id, email, roles, created_at: "" };
};
const admin = await actor("admin", ["admin"]), other = await actor("other"), dho = await actor("dho", ["dho"]);
const message = (contactId, text) => crm.recordCrmMessage({ contactId, provider: "qa", account: "search", externalId: randomUUID(), from: "cliente", text, historical: true });
const searchAll = (user, search, extra = {}) => {
  let page;
  for (let pass = 0; pass < 50; pass++) {
    page = crm.listCrmContactsPage(user, { search, searchMode: "all", ...extra });
    if (page.searchIndex.ready) return page;
  }
  throw Error("Search index did not finish within bounded test passes");
};
test.after(async () => { database.closeDb(); await rm(directory, { recursive: true, force: true, maxRetries: 5 }); });

test("contact search folds accents, accepts reordered/cross-field terms and Brazilian phone spellings", async () => {
  const seller = await actor("identity");
  const contact = crm.createContact(seller, { name: "Núbia Oliveira", company: "Magazine Móveis", email: "nubia@magazine.invalid", phone: "85988887777", city: "São Gonçalo" });
  for (const search of ["NUBIA", "oliveira nubia", "magazine nubia", "goncalo sao", "nubia@magazine.invalid", "+55 (85) 98888-7777", "558588887777", "(85) 8888-7777", "8888-7777"]) {
    const page = crm.listCrmContactsPage(seller, { search });
    assert.deepEqual(page.contacts.map(item => item.id), [contact.id], search);
    assert.ok(page.matches[contact.id]);
  }
  assert.equal(crm.listCrmContactsPage(seller, { search: "nubia" }).matches[contact.id].kind, "name");
  assert.equal(crm.listCrmContactsPage(seller, { search: "558588887777" }).matches[contact.id].kind, "phone");
});

test("exact and prefix identity results precede a mild name typo and conversation context", async () => {
  const seller = await actor("ranking");
  const exact = crm.createContact(seller, { name: "Cadeiras" });
  const prefix = crm.createContact(seller, { name: "Cadeiras Sul" });
  const typo = crm.createContact(seller, { name: "Cadeirax" });
  const context = crm.createContact(seller, { name: "Pessoa do projeto" });
  message(context.id, "Tenho interesse em cadeiras para o escritório.");
  db().prepare("UPDATE crm_contacts SET updated_at=? WHERE id=?").run("2099-01-01T00:00:00.000Z", context.id);
  const page = searchAll(seller, "cadeiras");
  assert.deepEqual(page.contacts.map(item => item.id), [exact.id, prefix.id, typo.id, context.id]);
  assert.match(page.matches[typo.id].snippet, /^Nome semelhante:/);
  assert.equal(page.matches[context.id].kind, "conversation");
  assert.equal(crm.listCrmContactsPage(seller, { search: "cadeiras" }).contacts.some(item => item.id === context.id), false);
});

test("optional local conversation search joins name and keyword terms without returning all history", async () => {
  const seller = await actor("conversation");
  const contact = crm.createContact(seller, { name: "Núbia Oliveira" });
  message(contact.id, "Quero um orçamento de duas cadeiras ergonômicas para o escritório.");
  message(contact.id, "Obrigada, aguardo o retorno.");
  const before = { contacts: db().prepare("SELECT count(*) n FROM crm_contacts").get().n, opportunities: db().prepare("SELECT count(*) n FROM crm_opportunities").get().n, messages: db().prepare("SELECT count(*) n FROM crm_messages").get().n };
  for (const query of ["ergonomica cadeira", "nubia cadeiras", "oliveira escritorio"]) {
    const page = searchAll(seller, query);
    assert.deepEqual(page.contacts.map(item => item.id), [contact.id]);
    assert.equal(page.matches[contact.id].kind, "conversation");
    assert.match(page.matches[contact.id].snippet, /cadeiras ergonômicas/);
    assert.equal(page.conversations[0].messages.length, 1);
    assert.equal(page.conversations[0].unread, 0);
  }
  assert.deepEqual({ contacts: db().prepare("SELECT count(*) n FROM crm_contacts").get().n, opportunities: db().prepare("SELECT count(*) n FROM crm_opportunities").get().n, messages: db().prepare("SELECT count(*) n FROM crm_messages").get().n }, before);
});

test("opportunity metadata is searchable by default and snippets redact links, invitation tokens and secrets", async () => {
  const seller = await actor("redaction");
  const op = crm.createOpportunity(seller, { newContact: { name: "Cliente da reforma" }, title: "Projeto corporativo", interest: "Mesas dobráveis", origin: "Indicação" });
  const opportunity = searchAll(seller, "dobra");
  assert.deepEqual(opportunity.contacts.map(item => item.id), [op.contactId]);
  assert.equal(opportunity.matches[op.contactId].kind, "opportunity");
  assert.equal(crm.listCrmContactsPage(seller, { search: "dobra" }).total, 1);
  const contact = crm.createContact(seller, { name: "Contato com mensagem" });
  const secret = "QAInvitationSecretValue";
  message(contact.id, `Quero estantes. Link https://example.invalid/interno/convite#token=${secret} token=${secret} api_key=${secret} ${"a".repeat(64)}`);
  const page = searchAll(seller, "estantes"), result = page.matches[contact.id];
  assert.equal(result.kind, "conversation");
  assert.ok(result.snippet.length <= 162);
  assert.ok(!result.snippet.includes(secret));
  assert.ok(!result.snippet.includes("https://"));
  assert.ok(!result.snippet.includes("a".repeat(64)));
  assert.ok(!page.conversations[0].messages[0].text.includes(secret), "search previews minimize exposure as well as match snippets");
  assert.ok(!page.conversations[0].messages[0].text.includes("https://"));
  assert.ok(crm.listCrmMessages(seller, contact.id)[0].text.includes(secret), "the protected original history is not rewritten");
});

test("search preserves fresh roles and portfolio/unit/attention filters, without SQL/FTS injection", async () => {
  const seller = await actor("scope");
  const unit = units.listUnitsPublic()[0];
  const owned = crm.createContact(seller, { name: "Escopo seguro", unitId: unit.id });
  const foreign = crm.createContact(other, { name: "Escopo seguro" });
  message(owned.id, "Armário sob medida"); message(foreign.id, "Armário sob medida");
  assert.deepEqual(searchAll(seller, "armario").contacts.map(item => item.id), [owned.id]);
  assert.deepEqual(Object.keys(searchAll(seller, "armario").matches), [owned.id]);
  assert.deepEqual(searchAll(admin, "armario", { ownerId: seller.id, unitId: unit.id }).contacts.map(item => item.id), [owned.id]);
  assert.equal(searchAll(seller, "armario", { unitId: randomUUID() }).total, 0);
  assert.equal(searchAll(seller, "armario", { attentionOnly: true }).total, 0);
  assert.throws(() => searchAll(seller, "armario", { ownerId: other.id }), /Forbidden/);
  assert.throws(() => searchAll(dho, "armario"), /Forbidden/);
  for (const query of ["' OR 1=1 --", '" OR *', "%", "_", "x) OR (1=1)"]) assert.equal(searchAll(seller, query).total, 0, query);
  const percent = crm.createContact(seller, { name: "100% escritório" });
  assert.deepEqual(crm.listCrmContactsPage(seller, { search: "%" }).contacts.map(item => item.id), [percent.id]);
  auth.disableUser(admin, seller.id);
  assert.throws(() => crm.listCrmContactsPage({ ...seller, roles: ["admin"] }, { search: "escopo" }), /Unauthorized/);
});

test("ranked keyset pages cover more than 500 results exactly once and reject changed scopes/ranks", async () => {
  const seller = await actor("pages");
  crm.ensureCrmSchema();
  const insert = db().prepare("INSERT INTO crm_contacts(id,owner_id,name,email,created_at,updated_at) VALUES(?,?,?,'',?,?)");
  for (let i = 0; i < 513; i++) insert.run(randomUUID(), seller.id, `Página Inteligente ${i}`, "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z");
  const ids = new Set();
  let before, firstCursor;
  do {
    const page = crm.listCrmContactsPage(seller, { search: "inteligente pagina", limit: 50, before });
    assert.equal(page.total, 513);
    firstCursor ||= page.nextCursor;
    for (const contact of page.contacts) { assert.ok(!ids.has(contact.id)); ids.add(contact.id); }
    before = page.nextCursor || undefined;
  } while (before);
  assert.equal(ids.size, 513);
  for (const patch of [{ search: "pagina" }, { searchMode: "all" }, { unitId: randomUUID() }, { attentionOnly: true }]) assert.throws(() => crm.listCrmContactsPage(seller, { search: "inteligente pagina", before: firstCursor, ...patch }), /Cursor inválido/);
  assert.throws(() => crm.listCrmContactsPage(other, { search: "inteligente pagina", before: firstCursor }), /Cursor inválido/);
  const decoded = JSON.parse(Buffer.from(firstCursor, "base64url").toString()); decoded.rank = -1;
  assert.throws(() => crm.listCrmContactsPage(seller, { search: "inteligente pagina", before: Buffer.from(JSON.stringify(decoded)).toString("base64url") }), /Cursor inválido/);
});

test("large existing message indexes backfill in bounded batches and track edits/deletes/new messages", async () => {
  const seller = await actor("index");
  const contact = crm.createContact(seller, { name: "Arquivo antigo" });
  // Simulate an existing database before this additive index existed.
  db().exec("DROP TRIGGER crm_message_search_insert; DROP TRIGGER crm_message_search_update; DROP TRIGGER crm_message_search_delete; DROP TABLE crm_message_search_documents; DROP TABLE crm_message_search; DROP TABLE crm_message_search_state;");
  const insert = db().prepare("INSERT INTO crm_messages(id,contact_id,provider,account,external_id,sender,text,sent_at,read_at) VALUES(?,?,'qa','index',?,'cliente',?,?,?)");
  let lastId;
  for (let i = 0; i < 1505; i++) {
    lastId = i === 1504 ? "ffffffff-ffff-4fff-afff-ffffffffffff" : randomUUID();
    insert.run(lastId, contact.id, lastId, i === 1504 ? "Luminárias pendentes" : "Mensagem antiga de arquivo", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z");
  }
  const first = crm.listCrmContactsPage(seller, { search: "luminaria", searchMode: "all" });
  assert.equal(first.searchIndex.ready, false, "incomplete indexes must be explicitly reported");
  assert.equal(first.total, 0);
  const final = searchAll(seller, "luminaria");
  assert.deepEqual(final.contacts.map(item => item.id), [contact.id]);
  // Message UUIDs stay stable even if SQLite rowids change during maintenance/restoration.
  db().prepare("UPDATE crm_messages SET rowid=rowid+100000 WHERE id=?").run(lastId);
  db().exec("VACUUM");
  assert.deepEqual(searchAll(seller, "luminaria").contacts.map(item => item.id), [contact.id]);
  db().prepare("UPDATE crm_messages SET text=? WHERE id=?").run("Tampão novo", lastId);
  assert.equal(searchAll(seller, "luminaria").total, 0);
  assert.deepEqual(searchAll(seller, "tampao").contacts.map(item => item.id), [contact.id]);
  db().prepare("DELETE FROM crm_messages WHERE id=?").run(lastId);
  assert.equal(searchAll(seller, "tampao").total, 0);
  message(contact.id, "Gaveteiros novos");
  assert.deepEqual(searchAll(seller, "gaveteiro").contacts.map(item => item.id), [contact.id]);
});
