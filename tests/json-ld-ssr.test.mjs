// Página de produto renderizada pelo servidor de produção (.output) com dados hostis no catálogo.
// Pula se não houver build: rode `npm run build` antes. Não usa rede externa nem o catálogo real.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const server = join(root, ".output", "server", "index.mjs");
const LS = String.fromCharCode(0x2028);
const attack = "</script><script>alert(1)</script>";

const product = (id, slug, fields = {}) => ({
  id, slug, sku: `SKU-${id}`, name: `Cadeira ${id}`, omieName: `CADEIRA ${id}`, category: "cadeiras", environments: [],
  brand: "MAG", line: "", color: "", image: "/images/product-placeholder.svg", images: ["/images/product-placeholder.svg"],
  price: null, stock: "PRONTA_ENTREGA", unit: "UN", available: 3, description: "Descrição comum.", ...fields,
});
const freePort = () => new Promise((done) => {
  const probe = createServer().listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => done(port)); });
});
const ldBlocks = (html) => {
  const open = '<script type="application/ld+json">'; const blocks = []; let at = 0;
  while ((at = html.indexOf(open, at)) !== -1) {
    const start = at + open.length; const end = html.indexOf("</script>", start);
    blocks.push(html.slice(start, end)); at = end;
  }
  return blocks;
};
const scriptTags = (html) => html.split("<script").length - 1;

test("produto com dados hostis: JSON-LD válido, nenhuma <script> nova, página renderiza", { skip: !existsSync(server) && "sem build (.output): rode npm run build" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "mag-jsonld-"));
  const products = [
    product("1", "cadeira-comum-sku-1"),
    // carga do pedido + campos com < > & e U+2028
    product("2", "cadeira-hostil-sku-2", { name: attack, sku: "X>1", brand: "Z>", color: "</script/", description: `<img src=x onerror=alert(2)// & ${LS} fim` }),
    // carga dividida em campos (a que sobrevive à limpeza do worker; executava alert antes da correção)
    product("3", "cadeira-dividida-sku-3", { name: "Cadeira</script/", sku: "XSS>1", brand: "Z>", description: "<img src=x onerror=alert(3)//" }),
  ];
  await mkdir(join(dir, "data"));
  await writeFile(join(dir, "catalog.json"), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), products, redirects: {} }));
  const port = await freePort();
  const child = spawn(process.execPath, [server], {
    cwd: root, stdio: "ignore",
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "production", SITE_DATA_DIR: join(dir, "data"),
      OMIE_CATALOG_PATH: join(dir, "catalog.json"), OMIE_IMAGE_DIR: join(dir, "images") },
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { await fetch(`${base}/api/health`); break; } catch { await new Promise((wait) => setTimeout(wait, 200)); }
    }
    const page = async (slug) => { const response = await fetch(`${base}/produto/${slug}`); return { status: response.status, html: await response.text() }; };
    const benign = await page(products[0].slug);
    assert.equal(benign.status, 200);
    assert.equal(ldBlocks(benign.html).length, 3, "Organization + Product + BreadcrumbList");
    for (const item of products.slice(1)) {
      const { status, html } = await page(item.slug);
      assert.equal(status, 200, item.slug);
      assert.equal(scriptTags(html), scriptTags(benign.html), `<script> a mais em ${item.slug}`);
      assert.ok(!html.includes("<script>alert") && !html.includes("<img src=x"), `carga crua no HTML de ${item.slug}`);
      const blocks = ldBlocks(html).map((block) => JSON.parse(block)); // lança se algum bloco não for JSON válido
      const ld = blocks.find((block) => block["@type"] === "Product");
      assert.equal(ld["@context"], "https://schema.org");
      assert.equal(ld.name, item.name);
      assert.equal(ld.sku, item.sku);
      assert.equal(ld.description, item.description);
      assert.equal(ld.brand.name, item.brand);
      assert.equal(blocks.find((block) => block["@type"] === "BreadcrumbList").itemListElement.at(-1).name, item.name);
      assert.ok(html.includes("<h1"), `página de ${item.slug} renderizou`);
    }
    // O nome aparece para o visitante como texto (escapado pelo React), sem ser cortado.
    assert.ok((await page(products[1].slug)).html.includes("&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
  } finally {
    // Espera o servidor sair antes de apagar a pasta (no Windows o SQLite aberto impede a remoção).
    const exited = child.exitCode !== null ? Promise.resolve() : new Promise((done) => child.once("exit", done));
    child.kill();
    await exited;
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
