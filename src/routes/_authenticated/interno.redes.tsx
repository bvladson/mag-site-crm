import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Trash2, Eye, EyeOff, ExternalLink } from "lucide-react";
import { getSocialAdmin, saveSocialSetting, createSocialItem, updateSocialItem, deleteSocialItem } from "@/lib/social-admin.functions";
import { NETWORKS, SOCIAL_MODES, networkInfo, type Network, type SocialMode } from "@/config/social";
import { Loading, ErrorState, Empty, PageTitle, Card, StatusBadge, fmtDate } from "@/components/interno/ui";
import { NetworkIcon } from "@/components/site/Social";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/interno/redes")({ component: SocialAdmin });

const MODE_LABEL: Record<SocialMode, string> = { api: "API (automático)", manual: "Manual (painel)", disabled: "Desligada" };
/** De onde veio o conteúdo sincronizado: conferir que é o perfil oficial ANTES de mudar a rede para "API". */
const ACCOUNT_LABEL: Record<Network, string> = { youtube: "Canal sincronizado", instagram: "Conta do token", tiktok: "Conta autorizada", linkedin: "Organização" };
const KINDS = [["post", "Publicação"], ["image", "Imagem"], ["carousel", "Carrossel"], ["reel", "Reels (vertical)"], ["short", "Vídeo curto (vertical)"], ["video", "Vídeo"]] as const;
const input = "mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm";
const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" });
const toBase64 = (file: File) => new Promise<string>((done, fail) => {
  const reader = new FileReader();
  reader.onload = () => done(String(reader.result).split(",")[1] ?? "");
  reader.onerror = fail;
  reader.readAsDataURL(file);
});
const message = (err: unknown, fallback: string) => {
  const text = err instanceof Error ? err.message : "";
  return text && !text.trim().startsWith("[") ? text : fallback;
};

function SocialAdmin() {
  const load = useServerFn(getSocialAdmin);
  const q = useQuery({ queryKey: ["interno", "social"], queryFn: () => load() });
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} />;
  return (
    <>
      <PageTitle title="Redes sociais" />
      <p className="mb-5 max-w-3xl text-sm text-muted-foreground">
        O site nunca chama as redes durante uma visita: o worker sincroniza de hora em hora (LinkedIn a cada 6 h) e o site mostra a última cópia boa.
        Chaves e tokens ficam só no servidor (<code>/opt/mag-site/secrets/social.env</code>), nunca neste painel.
        {q.data.checkedAt ? ` Última verificação do worker: ${fmtDate(q.data.checkedAt)}.` : " O worker ainda não rodou."}
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        {q.data.networks.map((network) => <NetworkCard key={network.network} network={network} />)}
      </div>
      <ManualItems items={q.data.items} />
    </>
  );
}

type AdminNetwork = Awaited<ReturnType<typeof getSocialAdmin>>["networks"][number];
function NetworkCard({ network }: { network: AdminNetwork }) {
  const save = useServerFn(saveSocialSetting);
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const sync = network.sync;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSaving(true);
    try {
      await save({ data: { network: network.network, mode: String(fd.get("mode")) as SocialMode, url: String(fd.get("url") ?? ""), handle: String(fd.get("handle") ?? "") } });
      toast.success(`${network.label}: salvo`);
      await qc.invalidateQueries({ queryKey: ["interno", "social"] });
    } catch (err) {
      toast.error(message(err, "Não foi possível salvar"));
    } finally { setSaving(false); }
  };
  return (
    <Card>
      <div className="flex items-center gap-2">
        <NetworkIcon network={network.network} className="size-5" />
        <h2 className="text-xl font-semibold">{network.label}</h2>
        <span className="ml-auto"><StatusBadge s={network.mode === "disabled" ? "desligada" : network.mode === "manual" ? "manual" : sync?.status ?? "desconectado"} /></span>
      </div>
      <form key={network.updatedAt ?? "padrao"} onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">Modo
          <select name="mode" defaultValue={network.mode} className={input}>
            {SOCIAL_MODES.map((mode) => <option key={mode} value={mode}>{MODE_LABEL[mode]}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">Nome exibido<input name="handle" defaultValue={network.handle} maxLength={80} placeholder="@perfil ou nome da página" className={input} /></label>
        <label className="block text-sm font-medium sm:col-span-2">Endereço oficial do perfil
          <input name="url" defaultValue={network.url} maxLength={300} placeholder={network.example} className={input} />
        </label>
        <Button type="submit" disabled={saving} className="sm:col-span-2">{saving ? "Salvando..." : "Salvar"}</Button>
      </form>
      <dl className="mt-4 grid grid-cols-[130px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Integração (API)</dt>
        <dd>{sync ? <StatusBadge s={sync.status} /> : "nunca verificada"}</dd>
        <dt className="text-muted-foreground">Último sync bom</dt><dd>{sync?.lastSuccessAt ? fmtDate(sync.lastSuccessAt) : "-"}</dd>
        <dt className="text-muted-foreground">Itens sincronizados</dt><dd>{sync?.itemCount ?? 0}</dd>
        <dt className="text-muted-foreground">{ACCOUNT_LABEL[network.network]}</dt>
        <dd className="break-words">{sync?.account ? [sync.account.name, sync.account.handle && `@${sync.account.handle}`, sync.account.id].filter(Boolean).join(" · ") : "-"}</dd>
        <dt className="text-muted-foreground">Perfil oficial</dt>
        <dd>{network.match === "confere" ? <span className="font-semibold text-success">confere com o endereço oficial</span>
          : network.match === "diverge" ? <span className="font-semibold text-destructive">NÃO confere — o site não publica este conteúdo</span>
          : <span className="text-muted-foreground">{sync?.account ? "conferir manualmente" : "-"}</span>}</dd>
        <dt className="text-muted-foreground">Último erro</dt><dd className="break-words">{sync?.error ?? "-"}</dd>
        <dt className="text-muted-foreground">Credenciais</dt><dd><code className="text-xs">{network.credentials.join(", ")}</code></dd>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">{network.access}</p>
    </Card>
  );
}

type ManualItem = Awaited<ReturnType<typeof getSocialAdmin>>["items"][number];
function ManualItems({ items }: { items: ManualItem[] }) {
  const create = useServerFn(createSocialItem);
  const update = useServerFn(updateSocialItem);
  const remove = useServerFn(deleteSocialItem);
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["interno", "social"] });
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get("image") as File | null;
    if (file && file.size > 2 * 1024 * 1024) { toast.error("Imagem maior que 2 MB"); return; }
    setSaving(true);
    try {
      await create({ data: {
        network: String(fd.get("network")) as Network, url: String(fd.get("url") ?? ""), title: String(fd.get("title") ?? ""),
        kind: String(fd.get("kind")) as (typeof KINDS)[number][0], published_at: String(fd.get("published_at") ?? ""),
        position: Number(fd.get("position") || 100), ...(file && file.size > 0 ? { image: { base64: await toBase64(file) } } : {}),
      } });
      toast.success("Destaque adicionado");
      form.reset();
      await refresh();
    } catch (err) {
      toast.error(message(err, "Não foi possível adicionar"));
    } finally { setSaving(false); }
  };
  return (
    <section className="mt-8">
      <h2 className="text-2xl font-semibold">Destaques manuais</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Aparecem no site quando a rede está em modo <b>Manual</b>. Use o link da publicação original; a imagem é opcional
        (JPG, PNG ou WebP até 2 MB). Para vídeo do YouTube sem imagem, a miniatura oficial é buscada automaticamente.
      </p>
      <form onSubmit={submit} className="mt-4 grid gap-3 rounded-md border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6">
        <label className="block text-sm font-medium">Rede
          <select name="network" className={input}>{NETWORKS.map((n) => <option key={n} value={n}>{networkInfo[n].label}</option>)}</select>
        </label>
        <label className="block text-sm font-medium lg:col-span-2">Link da publicação<input name="url" required maxLength={500} className={input} /></label>
        <label className="block text-sm font-medium lg:col-span-3">Texto do destaque<input name="title" maxLength={200} className={input} /></label>
        <label className="block text-sm font-medium">Tipo
          <select name="kind" className={input}>{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </label>
        <label className="block text-sm font-medium">Data<input name="published_at" type="date" className={input} /></label>
        <label className="block text-sm font-medium">Ordem<input name="position" type="number" min={0} max={999} defaultValue={100} className={input} /></label>
        <label className="block text-sm font-medium lg:col-span-2">Imagem (opcional)<input name="image" type="file" accept="image/jpeg,image/png,image/webp" className="mt-1 block w-full text-sm" /></label>
        <Button type="submit" disabled={saving} className="self-end">{saving ? "Enviando..." : "Adicionar"}</Button>
      </form>
      <div className="mt-4">
        {!items.length ? <Empty>Nenhum destaque manual cadastrado.</Empty> : (
          <ul className="divide-y rounded-md border bg-card">
            {items.map((item) => (
              <li key={item.id} className={`flex items-center gap-3 p-3 ${item.active ? "" : "opacity-50"}`}>
                {item.image ? <img src={`/social-images/m-${item.image}`} alt="" className="size-14 shrink-0 rounded object-cover" /> : <span className="grid size-14 shrink-0 place-items-center rounded bg-surface"><NetworkIcon network={item.network} /></span>}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground"><NetworkIcon network={item.network} className="size-3.5" /> {networkInfo[item.network].label} · ordem {item.position}{item.published_at ? ` · ${day(item.published_at)}` : ""}</p>
                  <p className="truncate font-medium">{item.title || "(sem texto)"}</p>
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 truncate text-xs text-brand underline">{item.url} <ExternalLink className="size-3" /></a>
                </div>
                <Button size="sm" variant="outline" aria-label={item.active ? "Ocultar" : "Mostrar"} onClick={async () => {
                  try { await update({ data: { id: item.id, active: !item.active, position: item.position } }); await refresh(); } catch (err) { toast.error(message(err, "Não foi possível alterar")); }
                }}>{item.active ? <EyeOff /> : <Eye />}</Button>
                <Button size="sm" variant="outline" aria-label="Excluir" onClick={async () => {
                  if (!window.confirm("Excluir este destaque?")) return;
                  try { await remove({ data: { id: item.id } }); await refresh(); } catch (err) { toast.error(message(err, "Não foi possível excluir")); }
                }}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
