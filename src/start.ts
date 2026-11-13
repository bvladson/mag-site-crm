import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
// Behind Nginx the Node server sees http:// URLs, so browsers without Sec-Fetch-Site
// (e.g. iOS < 16.4) would fail the default Origin === request-origin check. Accept the
// request's own origin plus the public HTTPS origins. Only evaluated on the server.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
  origin: (origin, ctx) => {
    const allowed = (process.env["SITE_PUBLIC_ORIGINS"] ?? "https://magmoveiscorporativos.com.br").split(",").map((o) => o.trim());
    return origin === new URL(ctx.request.url).origin || allowed.includes(origin);
  },
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
