// Serialização segura do JSON-LD (src/lib/seo.ts). Falha confirmada em 05/10/2026: dado do catálogo fechava o <script>.
// Sem barras invertidas no código do teste (caracteres montados por código) para não depender de escapes.
import test from "node:test";
import assert from "node:assert/strict";
import { jsonLd, breadcrumb } from "../src/lib/seo.ts";

const BS = String.fromCharCode(92);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const attack = "</script><script>alert(1)</script>";

test("carga </script> não sai crua e o valor volta idêntico", () => {
  const out = jsonLd({ "@context": "https://schema.org", "@type": "Product", name: attack });
  for (const char of ["<", ">", "&", LS, PS]) assert.ok(!out.includes(char), `caractere cru: ${char.charCodeAt(0)}`);
  assert.ok(!out.toLowerCase().includes("</script") && !out.includes("<!--"));
  assert.ok(out.includes(`${BS}u003c/script${BS}u003e`));
  assert.equal(JSON.parse(out).name, attack);
});

test("& > < U+2028 U+2029 viram escapes unicode e o texto é preservado (sanitização não destrutiva)", () => {
  const text = `A & B > C ${LS} D ${PS} E <!-- x --> "aspas"`;
  const out = jsonLd({ description: text });
  for (const code of ["0026", "003e", "003c", "2028", "2029"]) assert.ok(out.includes(`${BS}u${code}`), code);
  assert.equal(JSON.parse(out).description, text);
});

test("JSON-LD legítimo continua o mesmo depois de lido", () => {
  const product = {
    "@context": "https://schema.org", "@type": "Product", name: "Cadeira Presidente — Couro & Aço", sku: "MAG-10",
    description: "Encosto alto, 1,20 m", brand: { "@type": "Brand", name: "MAG" }, category: "Cadeiras", color: "Preto",
  };
  assert.deepEqual(JSON.parse(jsonLd(product)), product);
  const crumbs = JSON.parse(jsonLd(breadcrumb([["Início", "/"], ["Produtos", "/produtos"], [attack, "/produto/x"]])));
  assert.equal(crumbs["@type"], "BreadcrumbList");
  assert.equal(crumbs.itemListElement[2].name, attack);
  assert.equal(crumbs.itemListElement[2].position, 3);
});

test("dentro do HTML, nenhum fim de <script> antecipado (inclusive maiúsculas e campos divididos)", () => {
  const data = { name: "Cadeira</script/", sku: "XSS>1", description: "<img src=x onerror=alert(1)//", brand: { name: "Z>" }, color: "x</SCRIPT >y" };
  const html = `<script type="application/ld+json">${jsonLd(data)}</script>`;
  const inner = html.slice(html.indexOf(">") + 1, html.lastIndexOf("</script>"));
  assert.ok(!inner.toLowerCase().includes("</script"));
  assert.ok(!inner.includes("<") && !inner.includes(">"));
  assert.deepEqual(JSON.parse(inner), data);
});
