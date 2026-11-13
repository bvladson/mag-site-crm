/** Captura UTMs da primeira visita (sessionStorage) para anexar aos leads. */
const KEY = "mag-utm";
const FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];

export function captureUtm() {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  const found: Record<string, string> = {};
  FIELDS.forEach((f) => { const v = sp.get(f); if (v) found[f] = v.slice(0, 200); });
  if (Object.keys(found).length) sessionStorage.setItem(KEY, JSON.stringify(found));
  if (!sessionStorage.getItem(`${KEY}-ref`)) sessionStorage.setItem(`${KEY}-ref`, (document.referrer || "direto").slice(0, 500));
}

export function readUtm(): { utm: Record<string, string>; origem: string } {
  if (typeof window === "undefined") return { utm: {}, origem: "" };
  try {
    return { utm: JSON.parse(sessionStorage.getItem(KEY) ?? "{}"), origem: sessionStorage.getItem(`${KEY}-ref`) ?? "" };
  } catch {
    return { utm: {}, origem: "" };
  }
}
