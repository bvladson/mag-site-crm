/** Helpers de dados estruturados (Schema.org). URLs relativas até haver domínio oficial. */

/**
 * JSON para <script type="application/ld+json">. O conteúdo do script vai cru para o HTML, então um "</script"
 * vindo do Omie ou do editorial fecharia a tag (falha confirmada em 05/10/2026). < > & U+2028 U+2029 viram \uXXXX:
 * continua JSON válido e o valor lido é idêntico ao original — o texto exibido não é alterado.
 */
export const jsonLd = (data: object) =>
  JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

export const breadcrumb = (items: [string, string][]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })),
});
