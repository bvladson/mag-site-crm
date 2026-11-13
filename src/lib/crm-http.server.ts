import { sessionUser, requireActiveUser } from "./local-auth-core.server.ts";

export const crmPrivateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};
export function crmHttpUser(request: Request) {
  const cookie = (request.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("mag_site_session="));
  const actor = sessionUser(cookie?.slice("mag_site_session=".length));
  if (!actor) throw new Error("Unauthorized");
  return requireActiveUser(actor, ["admin", "comercial"]);
}
export function assertCrmUploadOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = new Set([
    new URL(request.url).origin,
    ...(process.env["SITE_PUBLIC_ORIGINS"] || "https://magmoveiscorporativos.com.br")
      .split(",")
      .map((value) => value.trim()),
  ]);
  if (!origin || !allowed.has(origin) || request.headers.get("sec-fetch-site") === "cross-site")
    throw new Error("Forbidden");
}
export async function readCrmUploadForm(request: Request) {
  const maximum = 8 * 1024 * 1024;
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;"))
    throw new Error("invalid_media");
  if (Number(request.headers.get("content-length")) > maximum) throw new Error("media_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_media");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new Error("media_too_large");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks);
  const response = new Response(body, {
    headers: { "Content-Type": request.headers.get("content-type")! },
  });
  const form = await response.formData();
  const files = form.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File)) throw new Error("invalid_media");
  return files[0];
}
export function crmHttpError(error: unknown, upload = false) {
  const message = error instanceof Error ? error.message : "";
  const status = /Unauthorized/.test(message)
    ? 401
    : /Forbidden|carteira|permissão/.test(message)
      ? 403
      : message === "media_too_large"
        ? 413
        : upload
          ? 400
          : 404;
  return Response.json(
    {
      error:
        status === 401
          ? "Entre no gerencial para acessar o anexo."
          : status === 403
            ? "Sem permissão para este anexo."
            : upload
              ? "Arquivo recusado. Verifique o tipo e o tamanho (até 7 MB)."
              : "Anexo não encontrado.",
    },
    { status, headers: crmPrivateHeaders },
  );
}
