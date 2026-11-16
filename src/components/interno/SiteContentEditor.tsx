import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  ExternalLink,
  Globe,
  History,
  LayoutTemplate,
  Loader2,
  Monitor,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings2,
  Smartphone,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  getSiteContentAdmin,
  publishSiteContent,
  restoreSiteContent,
  saveSiteContentDraft,
} from "@/lib/site-content-admin.functions";
import {
  newSiteBanner,
  SITE_NAVIGATION,
  SITE_SECTIONS,
  SITE_STATIC_LOGO,
  siteContentSchema,
  type SiteBanner,
  type SiteContent,
  type SiteContentAdmin,
  type SiteSection,
  type SiteSectionId,
} from "@/lib/site-content";
import { PageTitle } from "@/components/interno/ui";
import { SiteContentImage } from "./SiteContentImage";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const input =
  "mt-1 h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 disabled:opacity-60";
const tabs = [
  { id: "general", label: "Geral", icon: Settings2 },
  { id: "appearance", label: "Aparência e menu", icon: Palette },
  { id: "home", label: "Página inicial", icon: LayoutTemplate },
  { id: "banners", label: "Banners do site", icon: Eye },
  { id: "history", label: "Histórico", icon: History },
] as const;
type Tab = (typeof tabs)[number]["id"];
type Confirm =
  | { type: "publish" }
  | { type: "restore"; id: string; version: number }
  | { type: "reload" }
  | { type: "delete-banner"; id: string }
  | null;
const clone = <T,>(value: T): T => structuredClone(value);
const formatDate = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Fortaleza",
    dateStyle: "short",
    timeStyle: "short",
  });
const labels: Record<string, string> = {
  general: "Geral",
  home: "Página inicial",
  hero: "Banner principal",
  sections: "Seções",
  banners: "Banners",
  navigation: "Menu",
  appearance: "Aparência",
  seo: "Busca e compartilhamento",
  name: "Nome",
  title: "Título",
  text: "Texto",
  description: "Descrição",
  image: "Imagem",
  desktopImage: "Imagem para computador",
  email: "E-mail",
  whatsapp: "WhatsApp",
  startsAt: "Início",
  endsAt: "Fim",
  buttonHref: "Destino do botão",
  href: "Destino",
  primaryHref: "Destino principal",
  secondaryHref: "Destino secundário",
  label: "Rótulo",
};
const humanPath = (path: (string | number)[]) =>
  path.map((part) => (typeof part === "number" ? `${part + 1}` : labels[part] || part)).join(" → ");
function message(error: unknown) {
  const text = error instanceof Error ? error.message : "";
  return text && !text.startsWith("[") && !text.startsWith("{")
    ? text
    : "Não foi possível concluir. Suas alterações continuam neste editor. Tente novamente.";
}
function Panel({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {text && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}
function Field({
  label,
  value,
  onChange,
  max = 180,
  multiline = false,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
  multiline?: boolean;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="block min-w-0 text-sm font-medium">
      {label}
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={max}
          rows={3}
          className={`${input} h-auto py-2 font-normal`}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={max}
          className={`${input} font-normal`}
        />
      )}
      {hint && (
        <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-0 text-sm font-medium">
      {label}
      <select
        className={`${input} font-normal`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-brand"
      />
      <span>{label}</span>
    </label>
  );
}
function MoveButtons({
  label,
  index,
  count,
  move,
}: {
  label: string;
  index: number;
  count: number;
  move: (direction: -1 | 1) => void;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={index === 0}
        aria-label={`Subir ${label}`}
        onClick={() => move(-1)}
      >
        <ArrowUp className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={index === count - 1}
        aria-label={`Descer ${label}`}
        onClick={() => move(1)}
      >
        <ArrowDown className="size-4" />
      </Button>
    </div>
  );
}
const listSections = new Set<SiteSectionId>([
  "categories",
  "ready",
  "featured",
  "environments",
  "solutions",
  "cases",
  "clients",
  "social",
  "blog",
  "testimonials",
]);

export function SiteContentEditor({
  initial,
  onRefresh,
}: {
  initial: SiteContentAdmin;
  onRefresh: () => Promise<unknown>;
}) {
  const save = useServerFn(saveSiteContentDraft);
  const publish = useServerFn(publishSiteContent);
  const restore = useServerFn(restoreSiteContent);
  const load = useServerFn(getSiteContentAdmin);
  const [content, setContent] = useState<SiteContent>(() => clone(initial.draft.content));
  const [revision, setRevision] = useState(initial.draft.revision);
  const [snapshot, setSnapshot] = useState(() => JSON.stringify(initial.draft.content));
  const [publications, setPublications] = useState(initial.publications);
  const [publishedVersion, setPublishedVersion] = useState(initial.publishedVersion);
  const [tab, setTab] = useState<Tab>("general");
  const [selectedSection, setSelectedSection] = useState<SiteSectionId>("categories");
  const [selectedBanner, setSelectedBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploads, setUploads] = useState(0);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<"mobile" | "desktop">("mobile");
  const [previewReady, setPreviewReady] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(390);
  const frame = useRef<HTMLIFrameElement>(null);
  const previewBox = useRef<HTMLDivElement>(null);
  const sectionEditor = useRef<HTMLDivElement>(null);
  const contentRef = useRef(content);
  contentRef.current = content;
  const dirty = useMemo(() => JSON.stringify(content) !== snapshot, [content, snapshot]);
  const valid = useMemo(() => siteContentSchema.safeParse(content), [content]);
  const locked = busy !== null || uploads > 0;
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => (dirty || locked) && current.pathname !== next.pathname,
    enableBeforeUnload: dirty || locked,
    withResolver: true,
  });
  const section = content.home.sections.find((item) => item.id === selectedSection);
  const banner = content.home.banners.find((item) => item.id === selectedBanner);
  const onUploading = useCallback(
    (delta: number) => setUploads((value) => Math.max(0, value + delta)),
    [],
  );
  const sendPreview = useCallback(() => {
    const result = siteContentSchema.safeParse(contentRef.current);
    if (result.success)
      frame.current?.contentWindow?.postMessage(
        { type: "mag:site-preview", content: result.data },
        window.location.origin,
      );
  }, []);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== "mag:site-preview-ready"
      )
        return;
      setPreviewReady(true);
      sendPreview();
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [sendPreview]);
  useEffect(() => {
    if (!previewOpen) return;
    const timeout = window.setTimeout(sendPreview, 250);
    return () => window.clearTimeout(timeout);
  }, [content, previewOpen, sendPreview]);
  useEffect(() => {
    if (!previewOpen || !previewBox.current) return;
    const element = previewBox.current;
    const observer = new ResizeObserver(() => setPreviewWidth(element.clientWidth));
    setPreviewWidth(element.clientWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [previewOpen]);
  const patch = <K extends "general" | "appearance" | "seo" | "announcement">(
    key: K,
    values: Partial<SiteContent[K]>,
  ) => setContent((current) => ({ ...current, [key]: { ...current[key], ...values } }));
  const patchHero = (values: Partial<SiteContent["home"]["hero"]>) =>
    setContent((current) => ({
      ...current,
      home: { ...current.home, hero: { ...current.home.hero, ...values } },
    }));
  const patchEditorial = (values: Partial<SiteContent["home"]["editorial"]>) =>
    setContent((current) => ({
      ...current,
      home: { ...current.home, editorial: { ...current.home.editorial, ...values } },
    }));
  const patchProcessStep = (index: number, values: Partial<SiteContent["home"]["editorial"]["processSteps"][number]>) =>
    setContent((current) => ({
      ...current,
      home: { ...current.home, editorial: { ...current.home.editorial,
        processSteps: current.home.editorial.processSteps.map((step, position) => position === index ? { ...step, ...values } : step),
      } },
    }));
  const patchSection = (id: SiteSectionId, values: Partial<SiteSection>) =>
    setContent((current) => ({
      ...current,
      home: {
        ...current.home,
        sections: current.home.sections.map((item) =>
          item.id === id ? { ...item, ...values } : item,
        ),
      },
    }));
  const patchBanner = (id: string, values: Partial<SiteBanner>) =>
    setContent((current) => ({
      ...current,
      home: {
        ...current.home,
        banners: current.home.banners.map((item) =>
          item.id === id ? { ...item, ...values } : item,
        ),
      },
    }));
  const move = (kind: "sections" | "banners" | "navigation", index: number, direction: -1 | 1) => {
    setContent((current) => {
      if (kind === "navigation") {
        const navigation = [...current.navigation];
        const next = index + direction;
        if (next < 0 || next >= navigation.length) return current;
        [navigation[index], navigation[next]] = [navigation[next]!, navigation[index]!];
        return { ...current, navigation };
      }
      const items = [...current.home[kind]];
      const next = index + direction;
      if (next < 0 || next >= items.length) return current;
      [items[index], items[next]] = [items[next]!, items[index]!];
      return { ...current, home: { ...current.home, [kind]: items } };
    });
  };
  const fail = (cause: unknown) => {
    const text = message(cause);
    if (/alterad|outra aba|outra sessão|revision|conflit/i.test(text)) setConflict(true);
    setError(text);
    toast.error(text);
  };
  const updateHistory = (data: SiteContentAdmin) => {
    setPublications(data.publications);
    setPublishedVersion(data.publishedVersion);
  };
  const saveDraft = async () => {
    if (locked || conflict) return;
    const result = siteContentSchema.safeParse(content);
    if (!result.success) {
      setError("Revise os campos indicados antes de salvar.");
      return;
    }
    setBusy("save");
    setError("");
    try {
      const resultSave = await save({ data: { revision, content: result.data } });
      setRevision(resultSave.revision);
      setContent(result.data);
      setSnapshot(JSON.stringify(result.data));
      toast.success("Rascunho salvo. O site público continua na versão publicada.");
      void onRefresh().catch(() => {});
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
    }
  };
  const publishDraft = async () => {
    if (locked || dirty || conflict || !valid.success) return;
    setConfirm(null);
    setBusy("publish");
    setError("");
    try {
      const result = await publish({ data: { revision } });
      setPublishedVersion(result.version);
      toast.success(`Versão ${result.version} publicada no site.`);
      try {
        updateHistory(await load());
      } catch {
        /* Publication succeeded; history can be refreshed later. */
      }
      void onRefresh().catch(() => {});
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(null);
    }
  };
  const reload = async (restoreId?: string) => {
    if (locked) return;
    setConfirm(null);
    setBusy(restoreId ? "restore" : "reload");
    setError("");
    let restoreApplied = false;
    try {
      if (restoreId) {
        await restore({ data: { revision, publicationId: restoreId } });
        restoreApplied = true;
      }
      const data = await load();
      setContent(clone(data.draft.content));
      setRevision(data.draft.revision);
      setSnapshot(JSON.stringify(data.draft.content));
      updateHistory(data);
      setConflict(false);
      toast.success(
        restoreId
          ? "Versão copiada para o rascunho. Confira a prévia antes de publicar."
          : "Versão salva carregada.",
      );
      void onRefresh().catch(() => {});
    } catch (cause) {
      if (restoreApplied) {
        const text =
          "A versão foi restaurada, mas não foi possível carregar o novo rascunho. Carregue a versão salva antes de continuar.";
        setConflict(true);
        setError(text);
        toast.error(text);
      } else {
        fail(cause);
      }
    } finally {
      setBusy(null);
    }
  };
  const addBanner = () => {
    if (content.home.banners.length >= 12 || locked) return;
    const item = newSiteBanner();
    setContent((current) => ({
      ...current,
      home: { ...current.home, banners: [...current.home.banners, item] },
    }));
    setSelectedBanner(item.id);
  };
  const showPreview = () => {
    setPreviewOpen(true);
    window.setTimeout(
      () => previewBox.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      50,
    );
  };
  const imageProps = { onUploading, disabled: locked };
  const frameWidth = previewMode === "mobile" ? 390 : 1440;
  const frameScale = Math.min(1, previewWidth / frameWidth);
  return (
    <>
      <PageTitle title="Editor do site">
        Atualize a identidade, os banners e os blocos da página inicial. Salve o rascunho, confira a
        prévia e publique quando estiver pronto.
      </PageTitle>
      <div className="sticky top-0 z-20 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/95 p-3 shadow-sm backdrop-blur sm:p-4">
        <div className="min-w-0 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <span className={`size-2 rounded-full ${dirty ? "bg-amber-500" : "bg-emerald-600"}`} />
            {uploads ? "Enviando imagem…" : dirty ? "Alterações não salvas" : "Rascunho salvo"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {publishedVersion
              ? `Site na versão ${publishedVersion}`
              : "O site usa a configuração atual até a primeira publicação"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={locked} onClick={showPreview}>
            <Eye />
            Prévia
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={locked || !dirty || conflict || !valid.success}
            onClick={() => void saveDraft()}
          >
            {busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}Salvar rascunho
          </Button>
          <Button
            type="button"
            disabled={locked || dirty || conflict || !valid.success}
            onClick={() => setConfirm({ type: "publish" })}
          >
            {busy === "publish" ? <Loader2 className="animate-spin" /> : <Send />}Publicar
          </Button>
        </div>
      </div>
      {(error || conflict) && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <p>
            {error ||
              "O rascunho mudou em outra sessão. Suas alterações foram mantidas neste editor. Carregue a versão salva para retomar a edição."}
          </p>
          {conflict && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              disabled={locked}
              onClick={() => setConfirm({ type: "reload" })}
            >
              <RefreshCw />
              Carregar versão salva
            </Button>
          )}
        </div>
      )}
      {!valid.success && (
        <div
          className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
          role="status"
        >
          <p className="font-semibold">Revise estes campos para salvar e atualizar a prévia:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {valid.error.issues.slice(0, 8).map((issue, index) => (
              <li key={index}>
                {humanPath(issue.path)}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Áreas do editor">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`site-panel-${id}`}
            id={`site-tab-${id}`}
            onClick={() => setTab(id)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium ${tab === id ? "border-brand bg-brand/5 text-brand" : "bg-card hover:border-brand/40"}`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
      <div
        className={`grid min-w-0 gap-6 ${previewOpen ? "2xl:grid-cols-[minmax(0,1fr)_minmax(350px,0.8fr)]" : ""}`}
      >
        <div
          className="min-w-0"
          id={`site-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`site-tab-${tab}`}
        >
          <fieldset disabled={locked} className="min-w-0 space-y-5 disabled:opacity-70">
            {tab === "general" && (
              <>
                <Panel
                  title="Identidade e atendimento"
                  text="Dados públicos usados no cabeçalho, no rodapé e nos canais de contato do site."
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Nome do site"
                      value={content.general.name}
                      max={100}
                      onChange={(name) => patch("general", { name })}
                    />
                    <Field
                      label="Slogan"
                      value={content.general.tagline}
                      onChange={(tagline) => patch("general", { tagline })}
                    />
                  </div>
                  <div className="grid gap-5 lg:grid-cols-2">
                    <SiteContentImage
                      label="Logotipo"
                      value={content.general.logo}
                      resetValue={SITE_STATIC_LOGO}
                      onChange={(logo) => {
                        if (logo) patch("general", { logo });
                      }}
                      {...imageProps}
                    />
                    <SiteContentImage
                      label="Ícone do navegador"
                      value={content.general.favicon}
                      resetValue={SITE_STATIC_LOGO}
                      hint="Prefira uma imagem quadrada, simples e legível em tamanho pequeno."
                      onChange={(favicon) => {
                        if (favicon) patch("general", { favicon });
                      }}
                      {...imageProps}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="WhatsApp geral"
                      value={content.general.whatsapp}
                      max={13}
                      hint="DDI 55, DDD e número, somente dígitos. Exemplo: 5585999999999."
                      onChange={(whatsapp) => patch("general", { whatsapp })}
                    />
                    <Field
                      label="Telefone geral"
                      value={content.general.phone}
                      max={40}
                      onChange={(phone) => patch("general", { phone })}
                    />
                    <Field
                      label="E-mail público"
                      value={content.general.email}
                      type="email"
                      max={200}
                      onChange={(email) => patch("general", { email })}
                    />
                  </div>
                  <Field
                    label="Apresentação no rodapé"
                    value={content.general.footerText}
                    max={500}
                    multiline
                    onChange={(footerText) => patch("general", { footerText })}
                  />
                  <div className="rounded-lg bg-surface p-3 text-xs leading-relaxed text-muted-foreground">
                    Endereços e contatos de cada loja são mantidos no{" "}
                    <a href="/interno/unidades" className="font-medium text-brand underline">
                      cadastro de unidades
                    </a>
                    . Perfis sociais ficam em{" "}
                    <a href="/interno/redes" className="font-medium text-brand underline">
                      Redes sociais
                    </a>
                    .
                  </div>
                </Panel>
                <Panel
                  title="Busca e compartilhamento"
                  text="Título, descrição e imagem usados ao compartilhar a página inicial e como base da identidade do site."
                >
                  <Field
                    label="Título da página inicial"
                    value={content.seo.title}
                    max={160}
                    onChange={(title) => patch("seo", { title })}
                  />
                  <Field
                    label="Descrição da página inicial"
                    value={content.seo.description}
                    max={320}
                    multiline
                    onChange={(description) => patch("seo", { description })}
                  />
                  <SiteContentImage
                    label="Imagem de compartilhamento"
                    value={content.seo.image}
                    onChange={(image) => patch("seo", { image })}
                    hint="Uma imagem horizontal funciona melhor ao compartilhar o link. Sem imagem própria, será usado o logotipo."
                    {...imageProps}
                  />
                </Panel>
                <Panel
                  title="Faixa de aviso"
                  text="Uma mensagem curta no topo do site para campanhas ou informações de atendimento."
                >
                  <Toggle
                    label="Exibir faixa de aviso"
                    checked={content.announcement.enabled}
                    onChange={(enabled) => patch("announcement", { enabled })}
                  />
                  <Field
                    label="Mensagem"
                    value={content.announcement.text}
                    max={240}
                    onChange={(text) => patch("announcement", { text })}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Texto do link"
                      value={content.announcement.label}
                      max={60}
                      onChange={(label) => patch("announcement", { label })}
                    />
                    <Field
                      label="Destino do link"
                      value={content.announcement.href}
                      max={1000}
                      hint="Caminho do site ou endereço HTTPS."
                      onChange={(href) => patch("announcement", { href })}
                    />
                  </div>
                </Panel>
              </>
            )}
            {tab === "appearance" && (
              <>
                <Panel
                  title="Aparência do site"
                  text="Escolha uma identidade consistente para os botões, os blocos e os espaços entre as seções."
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium">
                      Cor principal
                      <div className="mt-1 flex gap-2">
                        <input
                          type="color"
                          value={
                            /^#[0-9a-f]{6}$/i.test(content.appearance.brandColor)
                              ? content.appearance.brandColor
                              : "#981b28"
                          }
                          onChange={(event) =>
                            patch("appearance", { brandColor: event.target.value })
                          }
                          className="h-10 w-14 cursor-pointer rounded-md border bg-card p-1"
                        />
                        <input
                          aria-label="Código da cor principal"
                          value={content.appearance.brandColor}
                          maxLength={7}
                          className={`${input} mt-0`}
                          onChange={(event) =>
                            patch("appearance", { brandColor: event.target.value })
                          }
                        />
                      </div>
                    </label>
                    <Choice
                      label="Cantos dos elementos"
                      value={content.appearance.radius}
                      options={[
                        ["sharp", "Retos"],
                        ["soft", "Suaves"],
                        ["rounded", "Arredondados"],
                      ]}
                      onChange={(radius) =>
                        patch("appearance", {
                          radius: radius as SiteContent["appearance"]["radius"],
                        })
                      }
                    />
                    <Choice
                      label="Largura do conteúdo"
                      value={content.appearance.width}
                      options={[
                        ["standard", "Padrão"],
                        ["wide", "Ampla"],
                      ]}
                      onChange={(width) =>
                        patch("appearance", { width: width as SiteContent["appearance"]["width"] })
                      }
                    />
                    <Choice
                      label="Espaçamento entre blocos"
                      value={content.appearance.spacing}
                      options={[
                        ["comfortable", "Confortável"],
                        ["compact", "Compacto"],
                      ]}
                      onChange={(spacing) =>
                        patch("appearance", {
                          spacing: spacing as SiteContent["appearance"]["spacing"],
                        })
                      }
                    />
                  </div>
                </Panel>
                <Panel
                  title="Menu principal"
                  text="Altere os nomes, a ordem e a visibilidade dos destinos do menu."
                >
                  <div className="space-y-2">
                    {content.navigation.map((item, index) => (
                      <div
                        key={item.id}
                        className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border p-3"
                      >
                        <MoveButtons
                          label={`menu ${item.label}`}
                          index={index}
                          count={content.navigation.length}
                          move={(direction) => move("navigation", index, direction)}
                        />
                        <label className="min-w-[120px] flex-1">
                          <span className="sr-only">Nome no menu para {item.label}</span>
                          <input
                            className={`${input} mt-0`}
                            value={item.label}
                            maxLength={40}
                            onChange={(event) =>
                              setContent((current) => ({
                                ...current,
                                navigation: current.navigation.map((entry) =>
                                  entry.id === item.id
                                    ? { ...entry, label: event.target.value }
                                    : entry,
                                ),
                              }))
                            }
                          />
                          <span className="mt-1 block text-[11px] text-muted-foreground">
                            {SITE_NAVIGATION.find((entry) => entry.id === item.id)?.href}
                          </span>
                        </label>
                        <Toggle
                          label="Visível"
                          checked={item.enabled}
                          onChange={(enabled) =>
                            setContent((current) => ({
                              ...current,
                              navigation: current.navigation.map((entry) =>
                                entry.id === item.id ? { ...entry, enabled } : entry,
                              ),
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </Panel>
              </>
            )}
            {tab === "home" && (
              <>
                <Panel
                  title="Banner principal"
                  text="Escolha o formato de abertura da página e troque a imagem sem cortar a arte no envio."
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Choice
                      label="Formato"
                      value={content.home.hero.layout}
                      options={[
                        ["split", "Texto ao lado da imagem"],
                        ["overlay", "Texto sobre a imagem"],
                        ["banner", "Arte em largura total"],
                      ]}
                      onChange={(layout) =>
                        patchHero({ layout: layout as SiteContent["home"]["hero"]["layout"] })
                      }
                    />
                    <Choice
                      label="Alinhamento do texto"
                      value={content.home.hero.align}
                      options={[
                        ["left", "À esquerda"],
                        ["center", "Centralizado"],
                      ]}
                      onChange={(align) => patchHero({ align: align as "left" | "center" })}
                    />
                    <Choice
                      label="Enquadramento"
                      value={content.home.hero.imageFit}
                      options={[
                        ["cover", "Preencher o espaço"],
                        ["contain", "Preservar a imagem inteira"],
                      ]}
                      onChange={(imageFit) =>
                        patchHero({ imageFit: imageFit as "cover" | "contain" })
                      }
                    />
                  </div>
                  <div className="grid gap-5 lg:grid-cols-2">
                    <SiteContentImage
                      label="Imagem para computador"
                      value={content.home.hero.desktopImage}
                      onChange={(desktopImage) => patchHero({ desktopImage })}
                      hint="Sem imagem própria, a abertura atual da MAG será usada."
                      {...imageProps}
                    />
                    <SiteContentImage
                      label="Imagem para celular"
                      value={content.home.hero.mobileImage}
                      onChange={(mobileImage) => patchHero({ mobileImage })}
                      hint="Opcional. Sem imagem específica, o celular usa a imagem do computador."
                      {...imageProps}
                    />
                  </div>
                  <Field
                    label="Descrição da imagem"
                    value={content.home.hero.imageAlt}
                    max={240}
                    onChange={(imageAlt) => patchHero({ imageAlt })}
                  />
                  <Field
                    label="Chamada acima do título"
                    value={content.home.hero.eyebrow}
                    onChange={(eyebrow) => patchHero({ eyebrow })}
                  />
                  <Field
                    label="Título principal"
                    value={content.home.hero.title}
                    max={220}
                    onChange={(title) => patchHero({ title })}
                  />
                  <Field
                    label="Apresentação"
                    value={content.home.hero.text}
                    max={1000}
                    multiline
                    onChange={(text) => patchHero({ text })}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Botão principal"
                      value={content.home.hero.primaryLabel}
                      max={70}
                      onChange={(primaryLabel) => patchHero({ primaryLabel })}
                    />
                    <Field
                      label="Destino principal"
                      value={content.home.hero.primaryHref}
                      max={1000}
                      onChange={(primaryHref) => patchHero({ primaryHref })}
                    />
                    <Field
                      label="Botão secundário"
                      value={content.home.hero.secondaryLabel}
                      max={70}
                      onChange={(secondaryLabel) => patchHero({ secondaryLabel })}
                    />
                    <Field
                      label="Destino secundário"
                      value={content.home.hero.secondaryHref}
                      max={1000}
                      onChange={(secondaryHref) => patchHero({ secondaryHref })}
                    />
                  </div>
                </Panel>
                <Panel
                  title="Blocos da página inicial"
                  text="Use as setas para mudar a ordem e o controle de visibilidade para exibir ou ocultar cada seção."
                >
                  <div className="space-y-2">
                    {content.home.sections.map((item, index) => {
                      const label =
                        SITE_SECTIONS.find((entry) => entry.id === item.id)?.label || item.id;
                      return (
                        <div
                          key={item.id}
                          className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 ${selectedSection === item.id ? "border-brand bg-brand/5" : ""}`}
                        >
                          <MoveButtons
                            label={label}
                            index={index}
                            count={content.home.sections.length}
                            move={(direction) => move("sections", index, direction)}
                          />
                          <button
                            type="button"
                            className="min-w-[130px] flex-1 px-1 py-2 text-left text-sm font-medium"
                            onClick={() => {
                              setSelectedSection(item.id);
                              window.setTimeout(
                                () =>
                                  sectionEditor.current?.scrollIntoView({
                                    behavior: "smooth",
                                    block: "start",
                                  }),
                                30,
                              );
                            }}
                          >
                            {label}
                            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                              {item.enabled ? "Visível quando houver conteúdo" : "Oculto"}
                            </span>
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`${item.enabled ? "Ocultar" : "Exibir"} ${label}`}
                            aria-pressed={item.enabled}
                            onClick={() => patchSection(item.id, { enabled: !item.enabled })}
                          >
                            {item.enabled ? (
                              <Eye className="size-4" />
                            ) : (
                              <EyeOff className="size-4" />
                            )}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Produtos vêm do catálogo da MAG. Seções sem conteúdo publicado, como projetos,
                    depoimentos e blog, continuam ocultas até receberem conteúdo.
                  </p>
                </Panel>
                {section && (
                  <div ref={sectionEditor} className="scroll-mt-28">
                    <Panel
                      title={`Editar: ${SITE_SECTIONS.find((item) => item.id === section.id)?.label || section.id}`}
                    >
                      <Toggle
                        label="Exibir seção"
                        checked={section.enabled}
                        onChange={(enabled) => patchSection(section.id, { enabled })}
                      />
                      {section.id === "banners" ? (
                        <div className="rounded-lg bg-surface p-4 text-sm">
                          <p>
                            Os banners são editados na área “Banners do site”. A posição deste bloco
                            define onde aparecem na página.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            className="mt-3"
                            onClick={() => setTab("banners")}
                          >
                            Editar banners
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <Choice
                              label="Fundo da seção"
                              value={section.tone}
                              options={[
                                ["default", "Claro"],
                                ["surface", "Suave"],
                                ["dark", "Escuro"],
                              ]}
                              onChange={(tone) =>
                                patchSection(section.id, { tone: tone as SiteSection["tone"] })
                              }
                            />
                            {listSections.has(section.id) && (
                              <Choice
                                label="Formato da lista"
                                value={section.layout}
                                options={[
                                  ["default", "Padrão da seção"],
                                  ["grid", "Grade"],
                                  ["carousel", "Faixa horizontal"],
                                ]}
                                onChange={(layout) =>
                                  patchSection(section.id, {
                                    layout: layout as SiteSection["layout"],
                                  })
                                }
                              />
                            )}
                          </div>
                          <Field
                            label="Chamada acima do título"
                            value={section.eyebrow}
                            max={100}
                            onChange={(eyebrow) => patchSection(section.id, { eyebrow })}
                          />
                          <Field
                            label="Título da seção"
                            value={section.title}
                            max={180}
                            onChange={(title) => patchSection(section.id, { title })}
                          />
                          <Field
                            label="Texto de apoio"
                            value={section.text}
                            max={1200}
                            multiline
                            onChange={(text) => patchSection(section.id, { text })}
                          />
                          <SiteContentImage
                            label="Imagem da seção"
                            value={section.image}
                            onChange={(image) => patchSection(section.id, { image })}
                            hint={
                              ["project", "people", "cta"].includes(section.id)
                                ? "Substitui a imagem principal deste bloco. Remova para usar o padrão da MAG."
                                : "Opcional. Aparece na abertura desta seção."
                            }
                            {...imageProps}
                          />
                          <Field
                            label="Descrição da imagem da seção"
                            value={section.imageAlt}
                            max={240}
                            onChange={(imageAlt) => patchSection(section.id, { imageAlt })}
                          />
                          <div className="grid gap-4 sm:grid-cols-2">
                            <Field
                              label="Texto do botão"
                              value={section.buttonLabel}
                              max={70}
                              onChange={(buttonLabel) => patchSection(section.id, { buttonLabel })}
                            />
                            <Field
                              label="Destino do botão"
                              value={section.buttonHref}
                              max={1000}
                              onChange={(buttonHref) => patchSection(section.id, { buttonHref })}
                            />
                          </div>
                        </>
                      )}
                      {section.id === "manifesto" && (
                        <Field
                          label="Complemento do manifesto"
                          value={content.home.editorial.manifestoSupport}
                          max={1200}
                          multiline
                          onChange={(manifestoSupport) => patchEditorial({ manifestoSupport })}
                        />
                      )}
                      {section.id === "process" && (
                        <div className="space-y-4 border-t pt-4">
                          <h3 className="text-sm font-semibold">Etapas de atendimento</h3>
                          {content.home.editorial.processSteps.map((step, index) => (
                            <div key={index} className="space-y-3 rounded-lg border p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="mr-auto text-sm font-medium">Etapa {index + 1}</span>
                                <MoveButtons label={`Etapa ${index + 1}`} index={index} count={content.home.editorial.processSteps.length} move={(direction) => {
                                  const processSteps = [...content.home.editorial.processSteps];
                                  const next = index + direction;
                                  if (next < 0 || next >= processSteps.length) return;
                                  [processSteps[index], processSteps[next]] = [processSteps[next]!, processSteps[index]!];
                                  patchEditorial({ processSteps });
                                }} />
                                <Button type="button" variant="ghost" size="sm" disabled={content.home.editorial.processSteps.length <= 1} onClick={() => patchEditorial({ processSteps: content.home.editorial.processSteps.filter((_, position) => position !== index) })}>Remover etapa</Button>
                              </div>
                              <Field label={`Título da etapa ${index + 1}`} value={step.title} max={80} onChange={(title) => patchProcessStep(index, { title })} />
                              <Field label={`Descrição da etapa ${index + 1}`} value={step.text} max={400} multiline onChange={(text) => patchProcessStep(index, { text })} />
                            </div>
                          ))}
                          <Button type="button" variant="outline" disabled={content.home.editorial.processSteps.length >= 8} onClick={() => patchEditorial({ processSteps: [...content.home.editorial.processSteps, { title: "Nova etapa", text: "" }] })}>Adicionar etapa</Button>
                        </div>
                      )}
                      {section.id === "stats" && (
                        <div className="space-y-3 border-t pt-4">
                          <h3 className="text-sm font-semibold">Números institucionais</h3>
                          <p className="text-xs text-muted-foreground">
                            Preencha apenas números oficiais. Valores vazios não aparecem no site.
                          </p>
                          {content.home.stats.map((stat, index) => (
                            <div key={index} className="flex items-end gap-2">
                              <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                                <Field
                                  label={`Descrição ${index + 1}`}
                                  value={stat.label}
                                  max={100}
                                  onChange={(label) =>
                                    setContent((current) => ({
                                      ...current,
                                      home: {
                                        ...current.home,
                                        stats: current.home.stats.map((item, position) =>
                                          position === index ? { ...item, label } : item,
                                        ),
                                      },
                                    }))
                                  }
                                />
                                <Field
                                  label={`Valor ${index + 1}`}
                                  value={stat.value}
                                  max={60}
                                  onChange={(value) =>
                                    setContent((current) => ({
                                      ...current,
                                      home: {
                                        ...current.home,
                                        stats: current.home.stats.map((item, position) =>
                                          position === index ? { ...item, value } : item,
                                        ),
                                      },
                                    }))
                                  }
                                />
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Remover número ${index + 1}`}
                                onClick={() =>
                                  setContent((current) => ({
                                    ...current,
                                    home: {
                                      ...current.home,
                                      stats: current.home.stats.filter(
                                        (_, position) => position !== index,
                                      ),
                                    },
                                  }))
                                }
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          ))}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={content.home.stats.length >= 8}
                            onClick={() =>
                              setContent((current) => ({
                                ...current,
                                home: {
                                  ...current.home,
                                  stats: [
                                    ...current.home.stats,
                                    { label: "Novo indicador", value: "" },
                                  ],
                                },
                              }))
                            }
                          >
                            <Plus />
                            Adicionar indicador
                          </Button>
                        </div>
                      )}
                    </Panel>
                  </div>
                )}
              </>
            )}
            {tab === "banners" && (
              <>
                <Panel
                  title="Banners e campanhas do site"
                  text="Crie artes para a página inicial. Cada banner pode ter imagem própria para celular e período de exibição."
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {content.home.banners.length} de 12 banners
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={content.home.banners.length >= 12}
                      onClick={addBanner}
                    >
                      <Plus />
                      Adicionar banner
                    </Button>
                  </div>
                  {!content.home.sections.find((item) => item.id === "banners")?.enabled && (
                    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                      O bloco de banners está oculto. Ative-o em “Página inicial” para exibir estas
                      artes.
                    </p>
                  )}
                  {!content.home.banners.length && (
                    <div className="rounded-xl border border-dashed p-7 text-center">
                      <Eye className="mx-auto mb-3 size-6 text-muted-foreground" />
                      <p className="font-medium">Nenhum banner cadastrado</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Adicione a primeira arte e confira como ela fica na prévia.
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    {content.home.banners.map((item, index) => (
                      <div
                        key={item.id}
                        className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 ${selectedBanner === item.id ? "border-brand bg-brand/5" : ""}`}
                      >
                        <MoveButtons
                          label={`banner ${item.title || index + 1}`}
                          index={index}
                          count={content.home.banners.length}
                          move={(direction) => move("banners", index, direction)}
                        />
                        <button
                          type="button"
                          className="min-w-[130px] flex-1 px-1 py-2 text-left text-sm font-medium"
                          onClick={() => setSelectedBanner(item.id)}
                        >
                          {item.title || `Banner ${index + 1}`}
                          <span className="mt-1 block text-xs font-normal text-muted-foreground">
                            {item.enabled ? "Ativo" : "Inativo"}
                            {(item.startsAt || item.endsAt) && " · Com período definido"}
                          </span>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Excluir banner ${item.title || index + 1}`}
                          onClick={() => setConfirm({ type: "delete-banner", id: item.id })}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </Panel>
                {banner && (
                  <Panel title={`Editar ${banner.title || "banner"}`}>
                    <Toggle
                      label="Ativar este banner"
                      checked={banner.enabled}
                      onChange={(enabled) => patchBanner(banner.id, { enabled })}
                    />
                    <div className="grid gap-5 lg:grid-cols-2">
                      <SiteContentImage
                        label="Arte para computador"
                        value={banner.image}
                        onChange={(image) => patchBanner(banner.id, { image })}
                        {...imageProps}
                      />
                      <SiteContentImage
                        label="Arte para celular"
                        value={banner.mobileImage}
                        onChange={(mobileImage) => patchBanner(banner.id, { mobileImage })}
                        hint="Opcional. Sem esta arte, será usada a imagem do computador."
                        {...imageProps}
                      />
                    </div>
                    <Field
                      label="Descrição da arte"
                      value={banner.alt}
                      max={240}
                      onChange={(alt) => patchBanner(banner.id, { alt })}
                    />
                    <Field
                      label="Chamada acima do título"
                      value={banner.eyebrow}
                      max={100}
                      onChange={(eyebrow) => patchBanner(banner.id, { eyebrow })}
                    />
                    <Field
                      label="Título do banner"
                      value={banner.title}
                      max={160}
                      onChange={(title) => patchBanner(banner.id, { title })}
                    />
                    <Field
                      label="Texto de apoio"
                      value={banner.text}
                      max={600}
                      multiline
                      onChange={(text) => patchBanner(banner.id, { text })}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Texto do botão"
                        value={banner.buttonLabel}
                        max={70}
                        onChange={(buttonLabel) => patchBanner(banner.id, { buttonLabel })}
                      />
                      <Field
                        label="Destino do banner"
                        value={banner.href}
                        max={1000}
                        hint="Exemplo: /produtos ou https://..."
                        onChange={(href) => patchBanner(banner.id, { href })}
                      />
                      <Choice
                        label="Largura"
                        value={banner.width}
                        options={[
                          ["contained", "Alinhada ao conteúdo"],
                          ["full", "Toda a largura da página"],
                        ]}
                        onChange={(width) =>
                          patchBanner(banner.id, { width: width as SiteBanner["width"] })
                        }
                      />
                      <Choice
                        label="Exibição da arte"
                        value={banner.fit}
                        options={[
                          ["natural", "Imagem inteira, altura automática"],
                          ["cover", "Preencher a área do banner"],
                        ]}
                        onChange={(fit) =>
                          patchBanner(banner.id, { fit: fit as SiteBanner["fit"] })
                        }
                      />
                      <Choice
                        label="Alinhamento do texto"
                        value={banner.align}
                        options={[
                          ["left", "À esquerda"],
                          ["center", "Centralizado"],
                        ]}
                        onChange={(align) =>
                          patchBanner(banner.id, { align: align as SiteBanner["align"] })
                        }
                      />
                      <Choice
                        label="Fundo do texto"
                        value={banner.tone}
                        options={[
                          ["light", "Claro"],
                          ["dark", "Escuro"],
                        ]}
                        onChange={(tone) =>
                          patchBanner(banner.id, { tone: tone as SiteBanner["tone"] })
                        }
                      />
                    </div>
                    <div className="border-t pt-4">
                      <h3 className="mb-3 text-sm font-semibold">Período de exibição</h3>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field
                          label="Início"
                          value={banner.startsAt}
                          type="datetime-local"
                          max={16}
                          onChange={(startsAt) => patchBanner(banner.id, { startsAt })}
                        />
                        <Field
                          label="Fim"
                          value={banner.endsAt}
                          type="datetime-local"
                          max={16}
                          onChange={(endsAt) => patchBanner(banner.id, { endsAt })}
                        />
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        Horário de Fortaleza. Deixe em branco para exibir sem limite de data. O
                        agendamento passa a valer depois da publicação.
                      </p>
                    </div>
                  </Panel>
                )}
              </>
            )}
            {tab === "history" && (
              <Panel
                title="Histórico de publicações"
                text="Restaurar traz uma versão anterior para o rascunho. O site só muda quando você publicar novamente."
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirm({ type: "reload" })}
                >
                  <RefreshCw />
                  Carregar rascunho salvo
                </Button>
                {!publications.length ? (
                  <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                    Nenhuma publicação feita pelo editor. A configuração atual do site está
                    disponível no rascunho.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {publications.map((publication) => (
                      <div
                        key={publication.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                      >
                        <div>
                          <p className="text-sm font-semibold">
                            Versão {publication.version}
                            {publication.version === publishedVersion && (
                              <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                                Publicada
                              </span>
                            )}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDate(publication.publishedAt)} · {publication.publishedBy}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setConfirm({
                              type: "restore",
                              id: publication.id,
                              version: publication.version,
                            })
                          }
                        >
                          <History />
                          Restaurar ao rascunho
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}
          </fieldset>
        </div>
        {previewOpen && (
          <aside className="min-w-0 self-start rounded-xl border bg-card p-3 sm:p-4 2xl:sticky 2xl:top-28">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Prévia do rascunho</h2>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={previewMode === "mobile" ? "default" : "outline"}
                  onClick={() => setPreviewMode("mobile")}
                >
                  <Smartphone />
                  Celular
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={previewMode === "desktop" ? "default" : "outline"}
                  onClick={() => setPreviewMode("desktop")}
                >
                  <Monitor />
                  Computador
                </Button>
              </div>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              A prévia mostra o site com as alterações deste editor e considera os períodos de
              exibição dos banners.
              {!valid.success && " Revise os campos pendentes para atualizar a prévia."}
            </p>
            <div
              ref={previewBox}
              className="relative min-w-0 overflow-hidden rounded-lg border bg-surface"
              style={{ height: 850 * frameScale }}
            >
              <iframe
                ref={frame}
                src="/site-preview"
                title="Prévia privada do site MAG"
                className="absolute left-0 top-0 origin-top-left border-0 bg-white"
                style={{ width: frameWidth, height: 850, transform: `scale(${frameScale})` }}
                onLoad={sendPreview}
              />
              {!previewReady && (
                <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-card/95 p-3 text-xs">
                  <Loader2 className="size-4 animate-spin" />
                  Carregando prévia…
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <a
                href="/site-preview"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-brand"
              >
                <ExternalLink className="size-3.5" />
                Abrir rascunho salvo em outra aba
              </a>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPreviewOpen(false);
                  setPreviewReady(false);
                }}
              >
                Fechar prévia
              </Button>
            </div>
          </aside>
        )}
      </div>
      <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <Globe className="size-3.5" />O site público mostra sempre a última versão publicada.
      </p>
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !locked) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.type === "publish"
                ? "Publicar alterações no site?"
                : confirm?.type === "restore"
                  ? `Restaurar a versão ${confirm.version}?`
                  : confirm?.type === "delete-banner"
                    ? "Excluir este banner do rascunho?"
                    : "Carregar a versão salva?"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.type === "publish"
                ? "A identidade, os textos, os banners e o layout deste rascunho passarão a aparecer no site público. O histórico atual será preservado."
                : confirm?.type === "restore"
                  ? "A versão escolhida substituirá o rascunho atual. Alterações ainda não salvas neste editor serão descartadas. O site público não muda até uma nova publicação."
                  : confirm?.type === "delete-banner"
                    ? "O banner será removido deste rascunho. A versão publicada permanece até você salvar e publicar novamente."
                    : "O rascunho salvo no sistema substituirá as alterações deste editor. Alterações ainda não salvas serão descartadas."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={() => setConfirm(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={locked}
              onClick={() => {
                if (confirm?.type === "publish") void publishDraft();
                else if (confirm?.type === "restore") void reload(confirm.id);
                else if (confirm?.type === "reload") void reload();
                else if (confirm?.type === "delete-banner") {
                  const id = confirm.id;
                  setContent((current) => ({
                    ...current,
                    home: {
                      ...current.home,
                      banners: current.home.banners.filter((item) => item.id !== id),
                    },
                  }));
                  if (selectedBanner === id) setSelectedBanner(null);
                  setConfirm(null);
                }
              }}
            >
              {confirm?.type === "publish"
                ? "Publicar versão"
                : confirm?.type === "restore"
                  ? "Restaurar ao rascunho"
                  : confirm?.type === "delete-banner"
                    ? "Excluir banner"
                    : "Carregar versão salva"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sair do editor?</DialogTitle>
            <DialogDescription>
              {locked
                ? "Há uma operação em andamento. Aguarde a conclusão antes de sair."
                : "Há alterações ainda não salvas. Se você sair agora, elas serão descartadas."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => blocker.reset?.()}>
              Continuar editando
            </Button>
            <Button type="button" disabled={locked} onClick={() => blocker.proceed?.()}>
              Sair sem salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
