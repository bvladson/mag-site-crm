import { sessionUser, type Role, type SiteUser } from "./local-auth-core.server.ts";
import { SESSION_COOKIE } from "./local-auth.server";

/** Respostas das APIs internas: JSON, nunca em cache, nunca interpretadas como outro tipo. */
export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex",
    },
  });
}

/** Sessão + perfil conferidos no servidor: sem sessão 401, perfil errado 403. */
export function exigirPerfil(request: Request, perfis: Role[]): { usuario: SiteUser } | { resposta: Response } {
  const cookie = (request.headers.get("cookie") ?? "").split(";").map((parte) => parte.trim())
    .find((parte) => parte.startsWith(`${SESSION_COOKIE}=`));
  const usuario = sessionUser(cookie?.slice(SESSION_COOKIE.length + 1));
  if (!usuario) return { resposta: json(401, { ok: false, motivo: "sessao" }) };
  if (!usuario.roles.some((perfil) => perfis.includes(perfil))) return { resposta: json(403, { ok: false, motivo: "perfil" }) };
  return { usuario };
}

/** POST só da própria origem (o navegador sempre manda Origin em POST): bloqueia disparo por outro site. */
export function mesmaOrigem(request: Request) {
  if (request.headers.get("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin") return false;
  const origem = request.headers.get("origin");
  if (!origem) return false;
  const permitidas = (process.env["SITE_PUBLIC_ORIGINS"] ?? "https://magmoveiscorporativos.com.br").split(",").map((item) => item.trim());
  return origem === new URL(request.url).origin || permitidas.includes(origem);
}
