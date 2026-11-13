import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/links/qr.svg")({
  server: { handlers: { GET: async () => {
    const { default: QRCode } = await import("qrcode");
    const svg = await QRCode.toString("https://magmoveiscorporativos.com.br/links/", {
      type: "svg", errorCorrectionLevel: "M", margin: 4, width: 512,
      color: { dark: "#181818", light: "#ffffff" },
    });
    return new Response(svg, { headers: {
      "Content-Type": "image/svg+xml; charset=utf-8", "Content-Disposition": 'attachment; filename="mag-arvore-de-links-qr.svg"',
      "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  } } },
});
