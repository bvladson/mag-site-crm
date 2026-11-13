/** Templates de notificação interna (HTML simples + texto). Todos os valores são escapados. */
const esc = (v: unknown) =>
  String(v ?? "-").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Row = [string, unknown];
const fmtDate = (d = new Date()) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

function layout(title: string, sections: { title?: string | undefined; rows?: Row[]; html?: string }[], panelLink?: string) {
  const body = sections
    .map(
      (s) => `${s.title ? `<h3 style="margin:24px 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#9b1c1c">${esc(s.title)}</h3>` : ""}
${s.rows ? `<table style="width:100%;border-collapse:collapse;font-size:14px">${s.rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#666;width:150px;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#111">${esc(v)}</td></tr>`).join("")}</table>` : ""}${s.html ?? ""}`,
    )
    .join("");
  const link = panelLink ? `<p style="margin-top:28px"><a href="${esc(panelLink)}" style="background:#9b1c1c;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;font-weight:600">Abrir no painel MAG</a></p>` : "";
  const html = `<div style="background:#ffffff;font-family:Arial,sans-serif;padding:24px"><div style="max-width:620px;margin:0 auto"><p style="font-weight:700;color:#9b1c1c;margin:0">MAG Móveis Corporativos</p><h2 style="margin:6px 0 0;color:#111">${esc(title)}</h2>${body}${link}</div></div>`;
  const text = [title, ...sections.flatMap((s) => [s.title ? `\n${s.title.toUpperCase()}` : "", ...(s.rows ?? []).map(([k, v]) => `${k}: ${v ?? "-"}`)])].join("\n");
  return { html, text };
}

const utmRows = (origem?: string | null, utm?: Record<string, string>): Row[] => [
  ["URL/origem", origem],
  ["UTM Source", utm?.["utm_source"]],
  ["UTM Medium", utm?.["utm_medium"]],
  ["UTM Campaign", utm?.["utm_campaign"]],
];

export function quoteEmail(d: {
  protocolo: string; nome: string; empresa?: string | undefined; cnpj?: string | undefined; whatsapp: string; email: string; cidade: string; estado: string;
  mensagem?: string | undefined; origem?: string | undefined; utm?: Record<string, string> | undefined; items: { name: string; sku: string; qty: number }[]; panelLink?: string | undefined;
}) {
  const itemsHtml = `<table style="width:100%;border-collapse:collapse;font-size:14px"><tr style="text-align:left;color:#666"><th style="padding:6px 0">Produto</th><th>SKU</th><th style="text-align:right">Qtd</th></tr>${d.items.map((i) => `<tr><td style="padding:6px 0;border-top:1px solid #eee">${esc(i.name)}</td><td style="border-top:1px solid #eee">${esc(i.sku)}</td><td style="text-align:right;border-top:1px solid #eee">${esc(i.qty)}</td></tr>`).join("")}</table>`;
  const r = layout("Novo pedido de orçamento", [
    { rows: [["Protocolo", d.protocolo], ["Data e hora", fmtDate()]] },
    { title: "Cliente", rows: [["Nome", d.nome], ["Empresa", d.empresa], ["CNPJ", d.cnpj], ["WhatsApp", d.whatsapp], ["E-mail", d.email], ["Cidade/UF", `${d.cidade}/${d.estado}`]] },
    { title: "Produtos", html: itemsHtml },
    { title: "Mensagem", rows: [["", d.mensagem]] },
    { title: "Origem", rows: utmRows(d.origem, d.utm) },
  ], d.panelLink);
  return { subject: `Novo orçamento pelo site MAG — ${d.protocolo}`, html: r.html, text: `${r.text}\n\nProdutos:\n${d.items.map((i) => `${i.qty}x ${i.name} (${i.sku})`).join("\n")}` };
}

export function contactEmail(d: { protocolo: string; nome: string; empresa?: string | undefined; whatsapp: string; email: string; assunto: string; mensagem: string; origem?: string | undefined; utm?: Record<string, string> | undefined; panelLink?: string | undefined }) {
  const r = layout("Novo contato pelo site", [
    { rows: [["Protocolo", d.protocolo], ["Data e hora", fmtDate()]] },
    { title: "Contato", rows: [["Nome", d.nome], ["Empresa", d.empresa], ["WhatsApp", d.whatsapp], ["E-mail", d.email], ["Assunto", d.assunto]] },
    { title: "Mensagem", rows: [["", d.mensagem]] },
    { title: "Origem", rows: utmRows(d.origem, d.utm) },
  ], d.panelLink);
  return { subject: `Novo contato pelo site MAG — ${d.assunto}`, ...r };
}

export function applicationEmail(d: { protocolo: string; nome: string; email: string; whatsapp: string; cidade?: string | undefined; linkedin?: string | undefined; area?: string | undefined; vaga?: string | undefined; mensagem?: string | undefined; panelLink?: string | undefined }) {
  const banco = !d.vaga;
  const r = layout(banco ? "Novo perfil no Banco de Talentos" : "Nova candidatura", [
    { rows: [["Protocolo", d.protocolo], ["Data", fmtDate()], ["Vaga", d.vaga ?? "Banco de Talentos"]] },
    { title: "Candidato", rows: [["Nome", d.nome], ["E-mail", d.email], ["WhatsApp", d.whatsapp], ["Cidade", d.cidade], ["LinkedIn", d.linkedin], ["Área de interesse", d.area]] },
    { title: "Mensagem", rows: [["", d.mensagem]] },
    { html: `<p style="font-size:13px;color:#666;margin-top:20px">O currículo está armazenado com segurança e pode ser visualizado no painel interno por usuários autorizados.</p>` },
  ], d.panelLink);
  return { subject: banco ? `Novo perfil no Banco de Talentos MAG — ${d.nome}` : `Nova candidatura MAG — ${d.vaga}`, ...r };
}
