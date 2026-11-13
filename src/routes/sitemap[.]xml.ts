import { createFileRoute } from "@tanstack/react-router";
import { categories, environments, posts, cases } from "@/data/catalog";
import { listProducts } from "@/lib/omie";

/** Sitemap dinâmico: usa o domínio da requisição, então funciona em qualquer host. */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = "https://magmoveiscorporativos.com.br";
        const products = await listProducts();
        // Vagas: só as abertas (publicadas e no prazo). Encerradas mantêm a URL, mas saem do sitemap (noindex).
        const { listOpenJobs } = await import("@/lib/careers.server");
        const jobs = listOpenJobs();
        const { readPublicLinkTree } = await import("@/lib/links.server");
        const linksPublished = Boolean(readPublicLinkTree());
        const paths = [
          "/", "/produtos", "/ambientes", "/projetos", "/empresas", "/sobre", "/blog", "/carreiras", "/carreiras/banco-de-talentos", "/contato", "/redes",
          ...(linksPublished ? ["/links/"] : []),
          ...categories.filter((c) => products.some((p) => p.category === c.slug)).map((c) => `/categoria/${c.slug}`),
          ...environments.map((e) => `/ambientes/${e.slug}`),
          ...products.map((p) => `/produto/${p.slug}`),
          ...posts.map((p) => `/blog/${p.slug}`),
          ...jobs.map((j) => `/carreiras/vagas/${j.slug}`),
          ...cases.map((c) => `/projetos/${c.slug}`),
        ];
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((p) => `  <url><loc>${origin}${p}</loc></url>`).join("\n")}\n</urlset>`;
        return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
      },
    },
  },
});
