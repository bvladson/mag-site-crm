#!/usr/bin/env node
/**
 * Relatório de retenção de candidaturas — SOMENTE LEITURA: abre o banco em modo leitura e nunca apaga nada.
 * Uso na VPS:  cd /opt/mag-site && docker compose run --rm -T web node scripts/recruitment-retention.mjs [--json]
 * Prazos: RECRUITMENT_RETENTION_MONTHS e TALENT_BANK_RETENTION_MONTHS (opcional) em secrets/site.env, depois de a MAG
 * aprovar a Política de Privacidade. Sem prazo definido, o relatório só avisa. Não mostra nome, e-mail nem telefone.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { retentionPolicy, expiresAt, purposeOf } from "../src/lib/retention.ts";

export function retentionReport(rows, policy, now = Date.now()) {
  const items = rows.map((row) => {
    const expires = expiresAt(row, policy);
    return {
      protocolo: row.protocolo, recebida: row.created_at, status: row.status, finalidade: purposeOf(row),
      curriculo: Boolean(row.has_resume), expira: expires, vencida: Boolean(expires && Date.parse(expires) <= now),
    };
  });
  return {
    politica: { vagaMeses: policy.jobMonths, bancoMeses: policy.bankMonths, definida: policy.jobMonths !== null },
    total: items.length, comCurriculo: items.filter((item) => item.curriculo).length,
    vencidas: items.filter((item) => item.vencida), apagadas: 0,
  };
}

function main() {
  const file = join(resolve(process.env.SITE_DATA_DIR || "./.local-data"), "site.sqlite");
  const policy = retentionPolicy();
  let rows = [];
  if (existsSync(file)) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      rows = db.prepare(`SELECT protocolo, created_at, status, json_extract(data,'$.job_slug') AS job_slug,
        json_extract(data,'$.talent_bank') AS talent_bank, json_extract(data,'$.resume_path') IS NOT NULL AS has_resume
        FROM job_applications ORDER BY created_at`).all();
    } finally { db.close(); }
  }
  const report = retentionReport(rows, policy);
  if (process.argv.includes("--json")) { console.log(JSON.stringify(report)); return; }
  console.log(report.politica.definida
    ? `Política: vaga ${policy.jobMonths} meses; banco de talentos ${policy.bankMonths} meses (a partir da candidatura).`
    : "Prazo de retenção NÃO definido (RECRUITMENT_RETENTION_MONTHS): nenhuma data de expiração é calculada.");
  console.log(`Candidaturas: ${report.total} (com currículo: ${report.comCurriculo}). Vencidas: ${report.vencidas.length}.`);
  for (const item of report.vencidas) {
    console.log(`  ${item.protocolo}  recebida ${item.recebida.slice(0, 10)}  ${item.finalidade}  expirou ${item.expira.slice(0, 10)}  status: ${item.status}`);
  }
  console.log("Nada foi apagado (relatório somente leitura).");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
