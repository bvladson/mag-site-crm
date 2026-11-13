import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export type LeadTable = 'quote_requests' | 'contact_requests' | 'job_applications';
export type LocalRow = Record<string, any>;
let database: DatabaseSync | undefined;

/** Banco próprio do site (SQLite), isolado dos outros sistemas da VPS. */
export function dataDirectory() {
  return resolve(process.env['SITE_DATA_DIR'] || './.local-data');
}

export function getDb() {
  if (database) return database;
  const dir = dataDirectory();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  mkdirSync(join(dir, 'resumes'), { recursive: true, mode: 0o700 });
  database = new DatabaseSync(join(dir, 'site.sqlite'));
  database.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=5000;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, roles TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, action TEXT NOT NULL,
      target_id TEXT, created_at TEXT NOT NULL
    );
  `);
  for (const table of ['quote_requests', 'contact_requests', 'job_applications']) {
    database.exec(`CREATE TABLE IF NOT EXISTS ${table} (
      id TEXT PRIMARY KEY, protocolo TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      status TEXT NOT NULL, internal_notes TEXT, data TEXT NOT NULL CHECK(json_valid(data))
    ); CREATE INDEX IF NOT EXISTS ${table}_created ON ${table}(created_at);`);
  }
  database.exec(`CREATE TABLE IF NOT EXISTS quote_request_items (
    id TEXT PRIMARY KEY, quote_request_id TEXT NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
    slug TEXT NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL,
    qty INTEGER NOT NULL CHECK(qty >= 1 AND qty <= 10000)
  ); CREATE INDEX IF NOT EXISTS quote_items_parent ON quote_request_items(quote_request_id);`);
  // Vagas (RH/DHO, 05/10/2026). Só "publicada" dentro do prazo aparece como aberta; "encerrada" mantém a URL com aviso.
  database.exec(`CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
    area TEXT, location TEXT, work_model TEXT, contract_type TEXT, schedule TEXT,
    summary TEXT, description TEXT, responsibilities TEXT, requirements TEXT, differentials TEXT,
    status TEXT NOT NULL DEFAULT 'rascunho' CHECK(status IN ('rascunho','publicada','encerrada')),
    opened_at TEXT, closes_at TEXT, closed_at TEXT, priority INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, priority);`);
  // Status internos das candidaturas (05/10/2026): troca idempotente dos nomes antigos.
  database.exec(`UPDATE job_applications SET status = CASE status
    WHEN 'recebida' THEN 'novo' WHEN 'triagem' THEN 'em análise' WHEN 'gestor' THEN 'entrevista'
    WHEN 'banco' THEN 'banco de talentos' WHEN 'aprovada' THEN 'encerrado' WHEN 'encerrada' THEN 'encerrado' ELSE status END
    WHERE status IN ('recebida','triagem','gestor','banco','aprovada','encerrada');`);
  // Redes sociais (05/10/2026): modo e perfil oficial por rede + itens cadastrados à mão (modo "manual").
  // Tokens e chaves de API NUNCA ficam aqui: só no secrets/social.env do worker.
  database.exec(`CREATE TABLE IF NOT EXISTS social_settings (
    network TEXT PRIMARY KEY CHECK(network IN ('youtube','instagram','tiktok','linkedin')),
    mode TEXT NOT NULL CHECK(mode IN ('api','manual','disabled')), profile_url TEXT, handle TEXT,
    updated_at TEXT NOT NULL, updated_by TEXT
  );
  CREATE TABLE IF NOT EXISTS social_manual_items (
    id TEXT PRIMARY KEY, network TEXT NOT NULL CHECK(network IN ('youtube','instagram','tiktok','linkedin')),
    url TEXT NOT NULL, title TEXT, kind TEXT NOT NULL DEFAULT 'post', image TEXT, published_at TEXT,
    position INTEGER NOT NULL DEFAULT 100, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT
  ); CREATE INDEX IF NOT EXISTS social_manual_network ON social_manual_items(network, active, position);`);
  // Orçamento interno → Pedido de Venda no Omie (07/10/2026). Valores em centavos. Nada aqui é apagado pelo painel:
  // orçamento só é cancelado; vínculo com o Omie fica registrado com quem confirmou e quando.
  database.exec(`CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, document TEXT UNIQUE, name TEXT NOT NULL,
    omie_customer_id TEXT, omie_linked_at TEXT, omie_linked_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS internal_quotes (
    id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('rascunho','salvo','enviado','aceito','enviado_omie','erro_omie','cancelado')),
    owner_id TEXT NOT NULL REFERENCES users(id), customer_id TEXT REFERENCES customers(id), source_request_id TEXT,
    customer_name TEXT NOT NULL DEFAULT '', customer_trade_name TEXT, customer_document TEXT, customer_email TEXT,
    customer_phone TEXT, customer_city TEXT, customer_state TEXT, omie_customer_id TEXT,
    payment_code TEXT, payment_label TEXT, forecast_date TEXT, final_consumer INTEGER NOT NULL DEFAULT 1,
    nf_email TEXT, order_notes TEXT, internal_notes TEXT,
    gross_cents INTEGER NOT NULL DEFAULT 0, discount_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL DEFAULT 0,
    accepted_at TEXT, accepted_by TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS internal_quotes_owner ON internal_quotes(owner_id, updated_at);
  CREATE TABLE IF NOT EXISTS internal_quote_items (
    id TEXT PRIMARY KEY, quote_id TEXT NOT NULL REFERENCES internal_quotes(id) ON DELETE CASCADE, position INTEGER NOT NULL,
    omie_product_id TEXT NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL, unit TEXT NOT NULL,
    quantity REAL NOT NULL CHECK(quantity > 0), unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
    discount_type TEXT CHECK(discount_type IN ('percentual','valor')), discount_value REAL NOT NULL DEFAULT 0,
    gross_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL, applied_price_cents INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS internal_quote_items_quote ON internal_quote_items(quote_id, position);
  CREATE TABLE IF NOT EXISTS omie_sellers (
    omie_seller_id TEXT PRIMARY KEY, integration_code TEXT, name TEXT NOT NULL, email TEXT, inactive INTEGER NOT NULL,
    can_invoice INTEGER NOT NULL DEFAULT 0, own_orders_only INTEGER NOT NULL DEFAULT 0, last_synced_at TEXT NOT NULL, missing_since TEXT
  );
  CREATE TABLE IF NOT EXISTS seller_links (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, omie_seller_id TEXT NOT NULL,
    confirmed_by TEXT NOT NULL, confirmed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS omie_refs (
    kind TEXT NOT NULL CHECK(kind IN ('etapa','forma_pagamento','categoria','conta')), code TEXT NOT NULL, label TEXT NOT NULL,
    extra TEXT, inactive INTEGER NOT NULL DEFAULT 0, synced_at TEXT NOT NULL, PRIMARY KEY(kind, code)
  );
  CREATE TABLE IF NOT EXISTS omie_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT);
  CREATE TABLE IF NOT EXISTS omie_orders (
    quote_id TEXT PRIMARY KEY REFERENCES internal_quotes(id), integration_code TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL CHECK(state IN ('enviando','incerto','criado','erro')),
    omie_order_id TEXT, omie_order_number TEXT, omie_customer_id TEXT, omie_seller_id TEXT, stage_code TEXT, payment_code TEXT,
    sent_at TEXT, sent_by TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_attempt_at TEXT, last_error TEXT,
    status_stage TEXT, status_cancelled INTEGER, status_invoiced INTEGER, status_total_cents INTEGER, status_checked_at TEXT,
    payload_sha256 TEXT, items_snapshot TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );`);
  // Auditoria com detalhes técnicos (ids, resultado, duração) — nunca dado pessoal nem payload.
  if (!database.prepare("SELECT 1 FROM pragma_table_info('audit_log') WHERE name='details'").get()) {
    database.exec('ALTER TABLE audit_log ADD COLUMN details TEXT');
  }
  // Leitura de volta do pedido no Omie logo depois de criado (conferência campo a campo; só códigos e valores).
  if (!database.prepare("SELECT 1 FROM pragma_table_info('omie_orders') WHERE name='verification'").get()) {
    database.exec('ALTER TABLE omie_orders ADD COLUMN verification TEXT');
  }
  // Proposta comercial: campos do orçamento que só aparecem na proposta ao cliente (frete, montagem e desconto geral ainda
  // não vão para o Pedido no Omie) e as versões geradas (v1, v2…), cada uma com o retrato dos dados usados.
  for (const [coluna, tipo] of [['customer_contact', 'TEXT'], ['proposal_notes', 'TEXT'], ['valid_until', 'TEXT'],
    ['freight_cents', 'INTEGER NOT NULL DEFAULT 0'], ['assembly_cents', 'INTEGER NOT NULL DEFAULT 0'], ['general_discount_cents', 'INTEGER NOT NULL DEFAULT 0']] as const) {
    if (!database.prepare("SELECT 1 FROM pragma_table_info('internal_quotes') WHERE name=?").get(coluna)) database.exec(`ALTER TABLE internal_quotes ADD COLUMN ${coluna} ${tipo}`);
  }
  database.exec(`
  CREATE TABLE IF NOT EXISTS quote_proposals (
    id TEXT PRIMARY KEY, quote_id TEXT NOT NULL REFERENCES internal_quotes(id), version INTEGER NOT NULL, created_at TEXT NOT NULL,
    created_by TEXT NOT NULL, content_hash TEXT NOT NULL, snapshot TEXT NOT NULL, pdf_sha256 TEXT, UNIQUE(quote_id, version)
  );
  CREATE TABLE IF NOT EXISTS proposal_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT);`);
  // Nome que aparece como consultor(a) na proposta (a própria pessoa define em "Minha conta"; vazio = nome derivado).
  if (!database.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name='display_name'").get()) {
    database.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
  }
  // Perfil comercial por usuário (Minha conta): o PDF usa sempre o do DONO do orçamento; contatos só saem se marcados.
  database.exec(`CREATE TABLE IF NOT EXISTS proposal_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, name TEXT, role TEXT, phone TEXT, whatsapp TEXT, email TEXT, signature TEXT,
    show_phone INTEGER NOT NULL DEFAULT 0, show_whatsapp INTEGER NOT NULL DEFAULT 0, show_email INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL, updated_by TEXT
  );`);
  // Gestão das versões (08/10/2026 noite): uma vigente por orçamento; enviada/aceita congelam; arquivar e excluir só marcam
  // (soft-delete: a linha, o retrato e a auditoria ficam; o número da versão nunca é reutilizado).
  if (!database.prepare("SELECT 1 FROM pragma_table_info('quote_proposals') WHERE name='current'").get()) {
    for (const coluna of ['current INTEGER NOT NULL DEFAULT 0', 'owner_id TEXT', 'consultant_id TEXT', 'sent_at TEXT', 'sent_by TEXT', 'accepted_at TEXT',
      'accepted_by TEXT', 'archived_at TEXT', 'archived_by TEXT', 'deleted_at TEXT', 'deleted_by TEXT']) database.exec(`ALTER TABLE quote_proposals ADD COLUMN ${coluna}`);
    // Versões que já existiam: vigente = a mais recente; dono e consultor = o dono do orçamento (era a regra); "enviada" =
    // teve WhatsApp/e-mail/compartilhar registrado na auditoria ou o orçamento já foi enviado/aceito; "aceita" = vigente
    // de orçamento já aceito. Nada do conteúdo (retrato, PDF, autor, horário) muda.
    database.exec(`
      UPDATE quote_proposals SET owner_id=(SELECT owner_id FROM internal_quotes q WHERE q.id=quote_proposals.quote_id),
        consultant_id=(SELECT owner_id FROM internal_quotes q WHERE q.id=quote_proposals.quote_id);
      UPDATE quote_proposals SET current=1 WHERE version=(SELECT max(version) FROM quote_proposals x WHERE x.quote_id=quote_proposals.quote_id);
      UPDATE quote_proposals SET sent_at=(SELECT min(a.created_at) FROM audit_log a WHERE a.target_id=quote_proposals.quote_id
          AND a.action IN ('quote:proposta:whatsapp','quote:proposta:email','quote:proposta:compartilhar','quote:proposta:email_enviado')
          AND json_extract(a.details,'$.versao')=quote_proposals.version)
        WHERE sent_at IS NULL;
      UPDATE quote_proposals SET sent_at=(SELECT q.updated_at FROM internal_quotes q WHERE q.id=quote_proposals.quote_id)
        WHERE current=1 AND sent_at IS NULL AND (SELECT q.status FROM internal_quotes q WHERE q.id=quote_proposals.quote_id) IN ('enviado','aceito','enviado_omie','erro_omie');
      UPDATE quote_proposals SET accepted_at=(SELECT q.accepted_at FROM internal_quotes q WHERE q.id=quote_proposals.quote_id),
          accepted_by=(SELECT q.accepted_by FROM internal_quotes q WHERE q.id=quote_proposals.quote_id)
        WHERE current=1 AND (SELECT q.status FROM internal_quotes q WHERE q.id=quote_proposals.quote_id) IN ('aceito','enviado_omie','erro_omie');`);
  }
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS quote_proposals_vigente ON quote_proposals(quote_id) WHERE current=1');
  // Estados da versão (08/10/2026, 17h): abrir WhatsApp/e-mail/compartilhar = só "compartilhamento iniciado"; "enviada ao
  // cliente" só quando o vendedor marca (ou o orçamento é marcado enviado/aceito); "recusada" quando o cliente recusa.
  if (!database.prepare("SELECT 1 FROM pragma_table_info('quote_proposals') WHERE name='share_started_at'").get()) {
    for (const coluna of ['share_started_at TEXT', 'share_channel TEXT', 'refused_at TEXT', 'refused_by TEXT']) database.exec(`ALTER TABLE quote_proposals ADD COLUMN ${coluna}`);
    // A release anterior marcava "enviada" só por abrir o WhatsApp/e-mail/compartilhar: isso vira "compartilhamento
    // iniciado". Continua "enviada" só a versão que estava vigente quando o orçamento foi marcado enviado/aceito.
    const versoes = database.prepare('SELECT id, quote_id, version, created_at, sent_at FROM quote_proposals WHERE sent_at IS NOT NULL AND accepted_at IS NULL').all() as LocalRow[];
    const marcas = database.prepare(`SELECT created_at FROM audit_log WHERE target_id=? AND action IN ('quote:status:enviado','quote:accepted') ORDER BY created_at`);
    const proxima = database.prepare('SELECT min(created_at) AS em FROM quote_proposals WHERE quote_id=? AND version>?');
    const canal = database.prepare(`SELECT action FROM audit_log WHERE target_id=? AND action IN ('quote:proposta:whatsapp','quote:proposta:email','quote:proposta:compartilhar')
      AND json_extract(details,'$.versao')=? ORDER BY id LIMIT 1`);
    for (const v of versoes) {
      const ateSubstituir = String((proxima.get(String(v['quote_id']), Number(v['version'])) as LocalRow | undefined)?.['em'] ?? '9999');
      const marcadaEnviada = (marcas.all(String(v['quote_id'])) as LocalRow[]).some((m) => String(m['created_at']) >= String(v['created_at']) && String(m['created_at']) < ateSubstituir);
      if (marcadaEnviada) continue;
      const via = String((canal.get(String(v['quote_id']), Number(v['version'])) as LocalRow | undefined)?.['action'] ?? '').split(':').pop() || null;
      database.prepare('UPDATE quote_proposals SET share_started_at=sent_at, share_channel=?, sent_at=NULL, sent_by=NULL WHERE id=?').run(via, String(v['id']));
    }
  }
  // Qual versão o cliente aceitou (a futura criação do Pedido no Omie usa o retrato dela).
  if (!database.prepare("SELECT 1 FROM pragma_table_info('internal_quotes') WHERE name='accepted_proposal_id'").get()) {
    database.exec(`ALTER TABLE internal_quotes ADD COLUMN accepted_proposal_id TEXT;
      UPDATE internal_quotes SET accepted_proposal_id=(SELECT p.id FROM quote_proposals p WHERE p.quote_id=internal_quotes.id AND p.current=1)
        WHERE status IN ('aceito','enviado_omie','erro_omie');`);
  }
  // Conta corrente da VENDA (09/10/2026): escolhida em cada orçamento (não há conta padrão global) e congelada na versão
  // aceita no momento do aceite — o Pedido no Omie usa só a da versão aceita.
  if (!database.prepare("SELECT 1 FROM pragma_table_info('internal_quotes') WHERE name='selected_account_id'").get()) {
    database.exec('ALTER TABLE internal_quotes ADD COLUMN selected_account_id TEXT');
  }
  if (!database.prepare("SELECT 1 FROM pragma_table_info('quote_proposals') WHERE name='accepted_account_id'").get()) {
    for (const coluna of ['accepted_account_id TEXT', 'accepted_account_label TEXT']) database.exec(`ALTER TABLE quote_proposals ADD COLUMN ${coluna}`);
  }
  // Dados do PEDIDO de cada versão (09/10/2026, tarde): conta corrente, consumidor final e observações do pedido. Mudou
  // depois de gerada → a versão não pode ser aceita. Versões anteriores ficam sem (para aceitar: gerar nova versão).
  if (!database.prepare("SELECT 1 FROM pragma_table_info('quote_proposals') WHERE name='order_hash'").get()) {
    database.exec('ALTER TABLE quote_proposals ADD COLUMN order_hash TEXT');
  }
  if (process.platform !== 'win32') chmodSync(join(dir, 'site.sqlite'), 0o600);
  return database;
}

export function transaction<T>(operation: () => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** `details`: só dados técnicos (ids, resultado, duração, motivo) — nunca documento, contato, endereço ou payload. */
export function audit(actorId: string | null, action: string, targetId: string | null = null, details: Record<string, string | number | boolean | null> | null = null) {
  getDb().prepare('INSERT INTO audit_log(actor_id,action,target_id,created_at,details) VALUES (?,?,?,?,?)')
    .run(actorId, action, targetId, new Date().toISOString(), details ? JSON.stringify(details) : null);
}

export function insertLead(table: LeadTable, data: LocalRow) {
  const id = randomUUID();
  const protocolo = id.replaceAll('-', '').slice(0, 12).toUpperCase();
  const created = new Date().toISOString();
  const status = 'novo';
  getDb().prepare(`INSERT INTO ${table}(id,protocolo,created_at,updated_at,status,data) VALUES (?,?,?,?,?,?)`)
    .run(id, protocolo, created, created, status, JSON.stringify(data));
  return { id, protocolo };
}

/** Pedido e itens gravam juntos: nunca existe orçamento confirmado sem os itens. */
export function saveQuote(data: LocalRow, items: { slug: string; sku: string; name: string; qty: number }[]) {
  if (!items.length) throw new Error('Lista de orçamento vazia');
  return transaction(() => {
    const result = insertLead('quote_requests', data);
    const statement = getDb().prepare('INSERT INTO quote_request_items(id,quote_request_id,slug,sku,name,qty) VALUES (?,?,?,?,?,?)');
    for (const item of items) statement.run(randomUUID(), result.id, item.slug, item.sku, item.name, item.qty);
    return result;
  });
}

export function decodeLead(row: LocalRow): LocalRow {
  const { data, ...columns } = row;
  return { ...JSON.parse(data as string), ...columns };
}

export function readLead(table: LeadTable, id: string): LocalRow {
  const row = getDb().prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  if (!row) throw new Error('Registro não encontrado');
  return decodeLead(row);
}

export function updateLead(table: LeadTable, id: string, status: string, notes: string | null, actor: string) {
  return transaction(() => {
    const result = getDb().prepare(`UPDATE ${table} SET status=?,internal_notes=?,updated_at=? WHERE id=?`)
      .run(status, notes, new Date().toISOString(), id);
    if (!result.changes) throw new Error('Registro não encontrado');
    audit(actor, `update:${table}`, id);
    return { ok: true };
  });
}

export function consumeRateLimit(key: string, max: number, windowSeconds: number, now = Date.now()) {
  return transaction(() => {
    const db = getDb();
    db.prepare('DELETE FROM rate_limits WHERE reset_at<=?').run(now);
    const row = db.prepare(`INSERT INTO rate_limits(key,hits,reset_at) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET hits=hits+1 RETURNING hits`).get(key, now + windowSeconds * 1000);
    return Number(row?.['hits']) <= max;
  });
}

// ---------- Currículos: arquivos privados fora da pasta pública, nome interno aleatório ----------
const RESUME_PATH = /^\d{4}-\d{2}\/[0-9a-f-]{36}\.pdf$/;

function resumeFile(relative: string) {
  if (!RESUME_PATH.test(relative)) throw new Error('Currículo inválido');
  const root = join(dataDirectory(), 'resumes');
  const file = resolve(root, relative);
  if (!file.startsWith(root + sep)) throw new Error('Currículo inválido');
  return file;
}

export function storeResume(bytes: Uint8Array) {
  getDb();
  const relative = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.pdf`;
  const file = resumeFile(relative);
  mkdirSync(resolve(file, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' });
  return relative;
}

export function discardResume(relative: string) {
  try { unlinkSync(resumeFile(relative)); } catch { /* already gone */ }
}

export function readResume(relative: string) {
  return readFileSync(resumeFile(relative));
}

export function closeDb() {
  database?.close();
  database = undefined;
}
