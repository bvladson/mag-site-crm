import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  History,
  Link2,
  Loader2,
  MapPin,
  Monitor,
  MessageCircle,
  Plus,
  QrCode,
  Save,
  Send,
  Settings2,
  Smartphone,
  Trash2,
  Type,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  getLinkTreeAdmin,
  publishLinkTree,
  restoreLinkTree,
  saveLinkTreeDraft,
} from "@/lib/links-admin.functions";
import {
  imageUrl,
  BACKGROUND_MONTHS,
  BACKGROUND_PRESETS,
  currentLinkMonth,
  defaultLinkBackground,
  defaultLinkPresentation,
  linkTreeContentSchema,
  newLinkTreeItem,
  type LinkTreeContent,
  type LinkTreeItem,
} from "@/lib/links";
import { LinkTreeEditorImage } from "@/components/interno/LinkTreeEditorImage";
import { LinkCampaignEditor } from "@/components/interno/LinkCampaignEditor";
import { LinkPresentationEditor } from "@/components/interno/LinkPresentationEditor";
import {
  LinkOfficialUnits,
  officialUnitItem,
  useLinkOfficialUnits,
} from "@/components/interno/LinkOfficialUnits";
import { PageTitle, fmtDate } from "@/components/interno/ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type AdminData = Awaited<ReturnType<typeof getLinkTreeAdmin>>;
type ItemType = LinkTreeItem["type"];
type Confirm =
  | { type: "publish" }
  | { type: "delete"; id: string }
  | { type: "restore"; id: string; version: number }
  | { type: "reload" }
  | null;

const input =
  "mt-1 h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/10 disabled:opacity-60";
const area =
  "mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10";
const TYPES: { type: ItemType; label: string; description: string; icon: typeof Link2 }[] = [
  { type: "seller", label: "Vendedor", description: "Foto e WhatsApp", icon: UserRound },
  { type: "whatsapp", label: "WhatsApp", description: "Atendimento direto", icon: MessageCircle },
  { type: "location", label: "Unidade", description: "Endereço, mapas e equipe", icon: MapPin },
  { type: "link", label: "Link", description: "Catálogo, rede ou campanha", icon: Link2 },
  { type: "heading", label: "Grupo", description: "Título de uma seção", icon: Type },
];
const errorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  if (/conflict|conflito|outro administrador|alterado|atualizado.*outro/i.test(message))
    return "O rascunho foi atualizado em outra sessão. Suas alterações continuam neste editor. Consulte a versão salva antes de continuar.";
  return message && !message.startsWith("[") && !message.startsWith("{")
    ? message
    : "Não foi possível concluir. Suas alterações continuam neste editor. Tente novamente.";
};
const clone = <T,>(value: T): T => structuredClone(value);
type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number];
const PRESET_LABELS: Record<BackgroundPreset, string> = {
  brand: "Identidade MAG",
  summer: "Verão",
  carnival: "Carnaval",
  women: "Mês da Mulher",
  autumn: "Outono",
  work: "Mês do Trabalho",
  june: "São João",
  winter: "Inverno",
  fathers: "Mês dos Pais",
  spring: "Primavera",
  pink: "Outubro Rosa",
  blue: "Novembro Azul",
  christmas: "Natal",
};
const ACCENTS = [
  { value: "burgundy", label: "Bordô MAG", color: "#981b28" },
  { value: "ocean", label: "Azul", color: "#176b8c" },
  { value: "forest", label: "Verde", color: "#326b51" },
  { value: "amber", label: "Dourado", color: "#996216" },
] as const;

export function LinkTreeEditor({
  initial,
  onRefresh,
  focus = "links",
  summary,
}: {
  initial: AdminData;
  onRefresh: () => Promise<unknown>;
  focus?: "links" | "campaigns";
  summary?: ReactNode;
}) {
  const save = useServerFn(saveLinkTreeDraft);
  const publish = useServerFn(publishLinkTree);
  const restore = useServerFn(restoreLinkTree);
  const load = useServerFn(getLinkTreeAdmin);
  const officialUnits = useLinkOfficialUnits();
  const [content, setContent] = useState<LinkTreeContent>(() => clone(initial.draft.content));
  const [revision, setRevision] = useState(initial.draft.revision);
  const [snapshot, setSnapshot] = useState(() => JSON.stringify(initial.draft.content));
  const [publications, setPublications] = useState(initial.publications);
  const [publishedVersion, setPublishedVersion] = useState(initial.publishedVersion);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [previewMonth, setPreviewMonth] = useState(() => currentLinkMonth());
  const [previewMode, setPreviewMode] = useState<"mobile" | "desktop">("mobile");
  const [previewWidth, setPreviewWidth] = useState(390);
  const [previewReady, setPreviewReady] = useState(false);
  const [busy, setBusy] = useState<"save" | "publish" | "restore" | "reload" | null>(null);
  const [uploads, setUploads] = useState(0);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const previewBox = useRef<HTMLDivElement>(null);
  const previewState = useRef({ content, month: previewMonth });
  previewState.current = { content, month: previewMonth };
  const dirty = useMemo(() => JSON.stringify(content) !== snapshot, [content, snapshot]);
  const locked = busy !== null || uploads > 0;
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => (dirty || locked) && current.pathname !== next.pathname,
    enableBeforeUnload: dirty || locked,
    withResolver: true,
  });
  const item = content.items.find((entry) => entry.id === selected);
  const locations = content.items.filter((entry) => entry.type === "location");
  const sellers = content.items.filter((entry) => entry.type === "seller");
  const generalSellers = sellers.filter((entry) => !entry.locationId);
  const activeCount = content.items.filter((entry) => entry.active).length;
  const frameWidth = previewMode === "mobile" ? 390 : 1024;
  const frameScale = Math.min(1, previewWidth / frameWidth);
  const sendPreview = useCallback(() => {
    const parsed = linkTreeContentSchema.safeParse(previewState.current.content);
    if (!parsed.success) return;
    previewFrame.current?.contentWindow?.postMessage(
      { type: "mag:links-preview", content: parsed.data, month: previewState.current.month },
      window.location.origin,
    );
  }, []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== previewFrame.current?.contentWindow ||
        event.data?.type !== "mag:links-preview-ready"
      )
        return;
      setPreviewReady(true);
      sendPreview();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [sendPreview]);
  useEffect(() => {
    const timer = window.setTimeout(sendPreview, 250);
    return () => window.clearTimeout(timer);
  }, [content, previewMonth, sendPreview]);
  useEffect(() => {
    const element = previewBox.current;
    if (!element) return;
    const measure = () => {
      if (element.clientWidth > 0) setPreviewWidth(element.clientWidth);
    };
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(element);
    return () => observer.disconnect();
  }, [tab]);

  const patchContent = (patch: Partial<LinkTreeContent>) =>
    setContent((current) => ({ ...current, ...patch }));
  const patchItem = (id: string, patch: Partial<LinkTreeItem>) => {
    const entry = content.items.find((candidate) => candidate.id === id);
    if (
      entry?.type === "location" &&
      patch.active === false &&
      sellers.some((seller) => seller.locationId === id && seller.active)
    ) {
      setError(
        "Esta unidade tem vendedores visíveis. Oculte esses vendedores ou vincule-os a outra unidade antes de ocultar a unidade.",
      );
      toast.warning("Revise os vendedores desta unidade antes de ocultá-la.");
      return;
    }
    if (
      entry?.type === "seller" &&
      patch.active === true &&
      entry.locationId &&
      !locations.some((location) => location.id === entry.locationId && location.active)
    ) {
      setError(
        "Para exibir este vendedor, escolha uma unidade visível ou a opção Equipe geral no cadastro do vendedor.",
      );
      toast.warning("A unidade deste vendedor está oculta.");
      return;
    }
    setContent((current) => ({
      ...current,
      items: current.items.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    }));
  };
  const move = (id: string, direction: -1 | 1) => {
    setContent((current) => {
      const items = [...current.items];
      const index = items.findIndex((entry) => entry.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= items.length) return current;
      [items[index], items[next]] = [items[next]!, items[index]!];
      return { ...current, items: items.map((entry, position) => ({ ...entry, position })) };
    });
  };
  const edit = (id: string) => {
    setSelected(id);
    window.setTimeout(
      () => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      40,
    );
  };
  const add = (type: ItemType) => {
    if (content.items.length >= 100 || locked) return;
    if (type === "location") {
      document
        .getElementById("links-official-units")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      toast.info(
        "Escolha uma unidade do cadastro oficial. Se precisar, cadastre a nova unidade em Administração.",
      );
      return;
    }
    const entry = { ...newLinkTreeItem(type), position: content.items.length };
    setContent((current) => ({ ...current, items: [...current.items, entry] }));
    edit(entry.id);
  };
  const duplicate = (entry: LinkTreeItem) => {
    if (content.items.length >= 100) return;
    const copy = {
      ...clone(entry),
      id: crypto.randomUUID(),
      active: false,
      position: content.items.length,
      title: entry.title ? `${entry.title.slice(0, 112)} (cópia)` : "",
    };
    setContent((current) => ({ ...current, items: [...current.items, copy] }));
    edit(copy.id);
    toast.success("Bloco duplicado e oculto. Revise antes de exibir.");
  };
  const validate = () => {
    const checked = linkTreeContentSchema.safeParse(content);
    if (checked.success) return checked.data;
    const problem = checked.error.issues[0];
    if (problem?.path[0] === "items" && typeof problem.path[1] === "number") {
      const invalid = content.items[problem.path[1]];
      if (invalid) edit(invalid.id);
      setError(
        `Revise o bloco ${problem.path[1] + 1}${invalid?.title ? ` (${invalid.title})` : ""}: ${problem.message}`,
      );
    } else setError(problem?.message ?? "Revise os campos antes de salvar.");
    setTab("edit");
    return null;
  };
  const persist = async () => {
    const checked = validate();
    if (!checked) return null;
    const result = await save({ data: { revision, content: checked } });
    setRevision(result.revision);
    setContent(checked);
    setSnapshot(JSON.stringify(checked));
    setConflict(false);
    return result.revision;
  };
  const handleError = (cause: unknown) => {
    const message = errorMessage(cause);
    setError(message);
    if (/outra sessão|outra aba|conflict|conflito/i.test(message)) setConflict(true);
    toast.error("Não foi possível concluir. Confira a mensagem no editor.");
  };
  const saveDraft = async () => {
    if (locked) return;
    setBusy("save");
    setError("");
    try {
      if ((await persist()) !== null) {
        toast.success("Rascunho salvo. Publique quando estiver pronto.");
        await onRefresh().catch(() => undefined);
      }
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(null);
    }
  };
  const refreshState = async () => {
    const result = await load();
    setContent(clone(result.draft.content));
    setSnapshot(JSON.stringify(result.draft.content));
    setRevision(result.draft.revision);
    setPublications(result.publications);
    setPublishedVersion(result.publishedVersion);
    setSelected(null);
    setConflict(false);
    await onRefresh().catch(() => undefined);
  };
  const execute = async () => {
    if (!confirm || locked) return;
    if (confirm.type === "delete") {
      const id = confirm.id;
      setContent((current) => ({
        ...current,
        items: current.items
          .filter((entry) => entry.id !== id)
          .map((entry, position) => ({
            ...entry,
            position,
            locationId: entry.locationId === id ? null : entry.locationId,
          })),
        campaigns: current.campaigns.map((campaign) =>
          campaign.locationId === id ? { ...campaign, locationId: null, active: false } : campaign,
        ),
      }));
      if (selected === id) setSelected(null);
      setConfirm(null);
      return;
    }
    const action = confirm;
    setBusy(action.type);
    setError("");
    try {
      if (action.type === "publish") {
        if (!validate()) {
          setConfirm(null);
          return;
        }
        const currentRevision = dirty ? await persist() : revision;
        if (currentRevision === null) {
          setConfirm(null);
          return;
        }
        const result = await publish({ data: { revision: currentRevision } });
        setPublishedVersion(result.version);
        setConfirm(null);
        toast.success(`Versão ${result.version} publicada.`);
        try {
          const latest = await load();
          setPublications(latest.publications);
        } catch {
          toast.warning(
            "Publicação concluída. O histórico será atualizado quando você reabrir o editor.",
          );
        }
        await onRefresh().catch(() => undefined);
      } else if (action.type === "restore") {
        await restore({ data: { revision, publicationId: action.id } });
        try {
          await refreshState();
          setConfirm(null);
          toast.success(
            "Versão restaurada como rascunho. Revise e publique para atualizar a página.",
          );
        } catch {
          setConfirm(null);
          setConflict(true);
          setError(
            "A versão foi restaurada no servidor, mas não foi possível carregar o novo rascunho. Suas alterações locais continuam neste editor. Carregue a versão salva antes de continuar.",
          );
        }
      } else {
        await refreshState();
        setConfirm(null);
        toast.success("Versão salva carregada.");
      }
    } catch (cause) {
      setConfirm(null);
      handleError(cause);
    } finally {
      setBusy(null);
    }
  };
  const downloadDraft = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(content, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "mag-arvore-rascunho.json";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const onUploading = (delta: number) => setUploads((current) => Math.max(0, current + delta));

  return (
    <>
      <PageTitle title={focus === "campaigns" ? "Campanhas e banners" : "Árvore e campanhas"}>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/links/" target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Abrir página
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/links/qr.svg" download="mag-links-qr.svg">
              <QrCode /> Baixar QR Code
            </a>
          </Button>
        </div>
      </PageTitle>
      {summary}
      <p className="mb-5 max-w-3xl text-sm text-muted-foreground">
        Reúna atendimento, vendedores, endereços e os principais destinos da MAG. Só administradores
        editam esta página. Salve o rascunho e publique quando a prévia estiver pronta.
      </p>
      <div className="sticky top-[116px] z-20 mb-5 flex flex-wrap items-center gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-sm backdrop-blur lg:top-[110px]">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className={`size-2 rounded-full ${dirty ? "bg-amber-500" : "bg-success"}`} />
            {uploads > 0
              ? "Enviando imagem..."
              : dirty
                ? "Alterações não salvas"
                : "Rascunho salvo"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {publishedVersion ? `Versão pública ${publishedVersion}` : "Nenhuma versão publicada"} ·{" "}
            {activeCount} {activeCount === 1 ? "bloco ativo" : "blocos ativos"}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={locked || !dirty}
          onClick={() => void saveDraft()}
        >
          {busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}
          <span className="hidden sm:inline">Salvar rascunho</span>
          <span className="sm:hidden">Salvar</span>
        </Button>
        <Button
          type="button"
          disabled={locked || conflict}
          onClick={() => {
            setError("");
            if (validate()) setConfirm({ type: "publish" });
          }}
        >
          <Send /> Publicar
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
        >
          <p className="text-sm text-destructive">{error}</p>
          {conflict && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={downloadDraft}>
                Baixar minhas alterações
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirm({ type: "reload" })}>
                Carregar versão salva
              </Button>
            </div>
          )}
        </div>
      )}
      <div
        role="tablist"
        aria-label="Editor e prévia"
        className="mb-4 grid grid-cols-2 rounded-lg border bg-card p-1 xl:hidden"
      >
        <button
          type="button"
          role="tab"
          id="links-tab-edit"
          aria-controls="links-edit"
          aria-selected={tab === "edit"}
          tabIndex={tab === "edit" ? 0 : -1}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              setTab("preview");
              document.getElementById("links-tab-preview")?.focus();
            }
          }}
          onClick={() => setTab("edit")}
          className={`flex items-center justify-center gap-2 rounded-md py-2 text-sm font-medium ${tab === "edit" ? "bg-graphite text-graphite-foreground" : "text-muted-foreground"}`}
        >
          <Settings2 className="size-4" /> Editar conteúdo
        </button>
        <button
          type="button"
          role="tab"
          id="links-tab-preview"
          aria-controls="links-preview"
          aria-selected={tab === "preview"}
          tabIndex={tab === "preview" ? 0 : -1}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              setTab("edit");
              document.getElementById("links-tab-edit")?.focus();
            }
          }}
          onClick={() => setTab("preview")}
          className={`flex items-center justify-center gap-2 rounded-md py-2 text-sm font-medium ${tab === "preview" ? "bg-graphite text-graphite-foreground" : "text-muted-foreground"}`}
        >
          <Smartphone className="size-4" /> Prévia da árvore
        </button>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div
          id="links-edit"
          role="tabpanel"
          aria-labelledby="links-tab-edit"
          className={`${tab === "edit" ? "" : "hidden"} min-w-0 space-y-5 xl:block`}
        >
          <form
            ref={formRef}
            onSubmit={(event) => {
              event.preventDefault();
              void saveDraft();
            }}
          >
            <fieldset disabled={locked} className="min-w-0 space-y-5">
              <LinkOfficialUnits
                units={officialUnits.data ?? []}
                items={content.items}
                onAdd={(entry) => {
                  patchContent({ items: [...content.items, entry] });
                  edit(entry.id);
                }}
                disabled={locked}
              />
              <LinkCampaignEditor
                content={content}
                onChange={(campaigns) => patchContent({ campaigns })}
                onUploading={onUploading}
                disabled={locked}
              />
              <details className="group rounded-xl border bg-card" open>
                <summary className="cursor-pointer px-5 py-4 text-base font-semibold">
                  Identidade da página
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    Título, imagens e aparência
                  </span>
                </summary>
                <div className="grid gap-4 border-t p-5 sm:grid-cols-2">
                  <label className="text-sm font-medium sm:col-span-2">
                    Título da página
                    <input
                      value={content.title}
                      onChange={(event) => patchContent({ title: event.target.value })}
                      required
                      maxLength={120}
                      className={input}
                    />
                  </label>
                  <label className="text-sm font-medium sm:col-span-2">
                    Apresentação
                    <textarea
                      value={content.subtitle}
                      onChange={(event) => patchContent({ subtitle: event.target.value })}
                      maxLength={320}
                      rows={2}
                      className={area}
                      placeholder="Uma frase para receber quem chega à MAG"
                    />
                  </label>
                  <div>
                    <LinkTreeEditorImage
                      label="Logotipo"
                      value={content.logo}
                      onChange={(logo) => {
                        if (logo) patchContent({ logo });
                      }}
                      onUploading={onUploading}
                      disabled={locked}
                      removable={false}
                      contain
                    />
                  </div>
                  <div>
                    <LinkTreeEditorImage
                      label="Imagem de capa"
                      value={content.cover}
                      onChange={(cover) => patchContent({ cover })}
                      onUploading={onUploading}
                      disabled={locked}
                      contain
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      A capa ocupa toda a largura do topo, com altura automática e proporção
                      original preservada. Prefira uma arte horizontal.
                    </p>
                  </div>
                  <fieldset className="sm:col-span-2">
                    <legend className="mb-2 text-sm font-medium">Aparência</legend>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { value: "mag", label: "Identidade MAG", color: "bg-brand" },
                          { value: "light", label: "Claro", color: "border bg-white" },
                          { value: "dark", label: "Escuro", color: "bg-graphite" },
                        ] as const
                      ).map((theme) => (
                        <label
                          key={theme.value}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-xs font-medium focus-within:ring-2 focus-within:ring-brand ${content.theme === theme.value ? "border-brand bg-brand/5 ring-1 ring-brand" : "hover:border-foreground/30"}`}
                        >
                          <input
                            type="radio"
                            name="links-theme"
                            value={theme.value}
                            checked={content.theme === theme.value}
                            onChange={() => patchContent({ theme: theme.value })}
                            className="sr-only"
                          />
                          <span className={`size-4 shrink-0 rounded-full ${theme.color}`} />
                          {theme.label}
                          {content.theme === theme.value && (
                            <Check className="ml-auto size-3.5 shrink-0 text-brand" />
                          )}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
              </details>
              <LinkPresentationEditor
                presentation={content.presentation ?? defaultLinkPresentation()}
                onChange={(presentation) => patchContent({ presentation })}
                disabled={locked}
              />
              <BackgroundEditor
                background={content.background ?? defaultLinkBackground()}
                patch={(background) => patchContent({ background })}
                onUploading={onUploading}
                disabled={locked}
                previewMonth={previewMonth}
                onPreviewMonth={setPreviewMonth}
              />
              <section className="rounded-xl border bg-card p-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold">Blocos da página</h2>
                  <span className="text-xs text-muted-foreground">{content.items.length}/100</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Escolha um tipo de conteúdo para adicionar. Os novos blocos começam ocultos.
                </p>
                <div className="mt-4 rounded-lg border border-brand/15 bg-brand/5 p-4">
                  <h3 className="text-sm font-semibold">Unidades e equipe de vendas</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Cadastre as unidades com endereço, horário e cor. Depois, vincule os vendedores
                    à unidade correspondente. A página pública agrupa a equipe por unidade.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={content.items.length >= 100}
                      onClick={() => add("location")}
                    >
                      <MapPin /> Adicionar unidade
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={content.items.length >= 100}
                      onClick={() => add("seller")}
                    >
                      <UserRound /> Adicionar vendedor
                    </Button>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {locations.length} {locations.length === 1 ? "unidade" : "unidades"} ·{" "}
                    {sellers.length} {sellers.length === 1 ? "vendedor" : "vendedores"}
                    {generalSellers.length > 0
                      ? ` · ${generalSellers.length} na equipe geral, sem unidade`
                      : ""}
                  </p>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {TYPES.map(({ type, label, description, icon: Icon }) => (
                    <button
                      type="button"
                      key={type}
                      disabled={content.items.length >= 100}
                      onClick={() => add(type)}
                      className="flex items-center gap-3 rounded-lg border bg-surface/40 px-3 py-3 text-left transition-colors hover:border-brand/50 hover:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icon className="size-5 shrink-0 text-brand" />
                      <span>
                        <span className="block text-sm font-semibold">{label}</span>
                        <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
                          {description}
                        </span>
                      </span>
                      <Plus className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
                {!content.items.length ? (
                  <p className="mt-5 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Adicione o primeiro bloco para começar a montar sua página.
                  </p>
                ) : (
                  <ol className="mt-4 space-y-2">
                    {content.items.map((entry, index) => {
                      const info = TYPES.find((type) => type.type === entry.type)!;
                      const Icon = info.icon;
                      return (
                        <li
                          key={entry.id}
                          className={`overflow-hidden rounded-lg border ${selected === entry.id ? "border-brand ring-1 ring-brand/15" : ""} ${entry.active ? "" : "bg-surface/50"}`}
                        >
                          <div className="flex items-center gap-2 px-3 py-3">
                            <button
                              type="button"
                              onClick={() => edit(entry.id)}
                              className="flex min-w-0 flex-1 items-center gap-3 text-left"
                              aria-label={`Editar ${entry.title || info.label}`}
                            >
                              {entry.image ? (
                                <img
                                  src={imageUrl(entry.image, true)}
                                  alt=""
                                  className="size-10 shrink-0 rounded-lg object-cover"
                                />
                              ) : (
                                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface text-brand">
                                  <Icon className="size-4" />
                                </span>
                              )}
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold">
                                  {entry.title || `${info.label} sem título`}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                  {info.label}
                                  {!entry.active ? " · Oculto" : ""}
                                  {entry.highlight ? " · Destaque" : ""}
                                  {entry.type === "seller"
                                    ? ` · ${locations.find((location) => location.id === entry.locationId)?.title || "Equipe geral, sem unidade"}`
                                    : ""}
                                </span>
                              </span>
                            </button>
                            <div className="flex shrink-0 gap-0.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                disabled={index === 0}
                                onClick={() => move(entry.id, -1)}
                                aria-label={`Mover ${entry.title || info.label} para cima`}
                              >
                                <ArrowUp />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                disabled={index === content.items.length - 1}
                                onClick={() => move(entry.id, 1)}
                                aria-label={`Mover ${entry.title || info.label} para baixo`}
                              >
                                <ArrowDown />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => patchItem(entry.id, { active: !entry.active })}
                                aria-label={`${entry.active ? "Ocultar" : "Exibir"} ${entry.title || info.label}`}
                              >
                                {entry.active ? <Eye className="text-success" /> : <EyeOff />}
                              </Button>
                            </div>
                          </div>
                          {selected === entry.id && (
                            <div ref={editorRef} className="scroll-mt-56 border-t bg-card p-4">
                              <ItemEditor
                                item={
                                  officialUnits.data?.find((unit) => unit.id === entry.id)
                                    ? officialUnitItem(
                                        officialUnits.data.find((unit) => unit.id === entry.id)!,
                                        entry,
                                      )
                                    : entry
                                }
                                locations={locations}
                                patch={(patch) => patchItem(entry.id, patch)}
                                onUploading={onUploading}
                                disabled={locked}
                                officialUnit={
                                  officialUnits.data?.some((unit) => unit.id === entry.id) ?? false
                                }
                              />
                              <div className="mt-5 flex flex-wrap justify-between gap-2 border-t pt-3">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={content.items.length >= 100}
                                  onClick={() => duplicate(entry)}
                                >
                                  <Copy /> Duplicar
                                </Button>
                                <div className="flex gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setSelected(null)}
                                  >
                                    Concluir edição
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive"
                                    onClick={() => setConfirm({ type: "delete", id: entry.id })}
                                  >
                                    <Trash2 /> Excluir
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            </fieldset>
          </form>
          <details className="rounded-xl border bg-card">
            <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 font-semibold">
              <History className="size-4 text-brand" /> Histórico de publicações
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {publications.length} versões
              </span>
            </summary>
            <div className="border-t p-5">
              <p className="mb-4 text-sm text-muted-foreground">
                Restaurar cria um rascunho com a versão escolhida. A página pública só muda após uma
                nova publicação.
              </p>
              {publications.length ? (
                <ul className="divide-y">
                  {publications.map((publication) => (
                    <li
                      key={publication.id}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">
                          Versão {publication.version}
                          {publication.version === publishedVersion && (
                            <span className="ml-2 rounded-full bg-success/10 px-2 py-0.5 text-[10px] text-success">
                              No ar
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {fmtDate(publication.publishedAt)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={locked}
                        onClick={() =>
                          setConfirm({
                            type: "restore",
                            id: publication.id,
                            version: publication.version,
                          })
                        }
                      >
                        Restaurar
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  As versões aparecerão aqui depois da primeira publicação.
                </p>
              )}
            </div>
          </details>
          <div className="rounded-xl border bg-card p-5">
            <div className="flex items-start gap-3">
              <QrCode className="mt-0.5 size-5 shrink-0 text-brand" />
              <div>
                <h2 className="font-semibold">Um endereço para todas as conexões</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Use o QR Code em cartões, embalagens e no balcão. O endereço permanece o mesmo
                  quando você atualiza os blocos.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <code className="break-all text-xs">
                    https://magmoveiscorporativos.com.br/links/
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          "https://magmoveiscorporativos.com.br/links/",
                        );
                        toast.success("Endereço copiado.");
                      } catch {
                        toast.error("Copie o endereço exibido ao lado.");
                      }
                    }}
                  >
                    <Copy /> Copiar
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <aside
          id="links-preview"
          role="tabpanel"
          aria-labelledby="links-tab-preview"
          className={`${tab === "preview" ? "" : "hidden"} xl:sticky xl:top-[206px] xl:block`}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Smartphone className="size-4 text-brand" /> Prévia do rascunho
            </h2>
            <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              Rascunho
            </span>
          </div>
          <div className="mb-3 flex flex-wrap gap-2" aria-label="Tamanho da prévia">
            <Button
              type="button"
              size="sm"
              variant={previewMode === "mobile" ? "default" : "outline"}
              onClick={() => setPreviewMode("mobile")}
            >
              <Smartphone /> Celular
            </Button>
            <Button
              type="button"
              size="sm"
              variant={previewMode === "desktop" ? "default" : "outline"}
              onClick={() => setPreviewMode("desktop")}
            >
              <Monitor /> Computador
            </Button>
          </div>
          {content.background?.mode === "monthly" && (
            <label className="mb-3 block text-xs font-medium">
              Mês da prévia
              <select
                value={previewMonth}
                onChange={(event) => setPreviewMonth(Number(event.target.value))}
                className={input}
              >
                {BACKGROUND_MONTHS.map((month, index) => (
                  <option key={month} value={index + 1}>
                    {month}
                    {index + 1 === currentLinkMonth() ? " (mês atual)" : ""}
                  </option>
                ))}
              </select>
              <span className="mt-1 block font-normal text-muted-foreground">
                A prévia de outro mês não altera o calendário publicado.
              </span>
            </label>
          )}
          <div
            ref={previewBox}
            className="relative min-w-0 overflow-hidden rounded-2xl border bg-graphite shadow-xl"
            style={{ height: 850 * frameScale }}
          >
            <iframe
              ref={previewFrame}
              src="/links/preview"
              title="Prévia privada da árvore de links"
              className="absolute left-0 top-0 origin-top-left border-0"
              style={{ width: frameWidth, height: 850, transform: "scale(" + frameScale + ")" }}
              onLoad={sendPreview}
            />
            {!previewReady && (
              <p className="pointer-events-none absolute inset-x-0 top-0 bg-card/95 p-3 text-xs text-muted-foreground">
                Carregando prévia…
              </p>
            )}
          </div>
          <p className="mx-auto mt-3 max-w-[350px] text-center text-xs text-muted-foreground">
            A prévia acompanha suas edições. Blocos ocultos não aparecem. A página pública recebe
            apenas o que você publicar.
            {!linkTreeContentSchema.safeParse(content).success &&
              " Revise os campos pendentes para atualizar a prévia."}
          </p>
          <a
            href="/links/preview"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-9 items-center gap-1 text-xs font-medium text-brand hover:underline"
          >
            <ExternalLink className="size-3.5" /> Abrir rascunho salvo em outra aba
          </a>
        </aside>
      </div>
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.type === "publish"
                ? "Publicar árvore de links?"
                : confirm?.type === "delete"
                  ? "Excluir este bloco?"
                  : confirm?.type === "restore"
                    ? `Restaurar a versão ${confirm.version}?`
                    : "Carregar a versão salva?"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.type === "publish"
                ? `${dirty ? "Suas alterações serão salvas e publicadas. " : ""}Os visitantes passarão a ver o conteúdo da prévia. Você poderá restaurar uma versão anterior pelo histórico.`
                : confirm?.type === "delete"
                  ? `O bloco será removido deste rascunho.${content.items.find((entry) => entry.id === confirm.id)?.type === "location" && sellers.some((seller) => seller.locationId === confirm.id) ? " Os vendedores vinculados passarão para a equipe geral, sem unidade." : ""}${content.campaigns.some((campaign) => campaign.locationId === confirm.id) ? " Os banners desta unidade serão desativados para revisão." : ""} A página pública será atualizada somente quando você publicar.`
                  : confirm?.type === "restore"
                    ? `A versão escolhida substituirá o rascunho atual.${dirty ? " As alterações ainda não salvas neste editor serão descartadas." : ""} A página pública continuará igual até você publicar.`
                    : "As alterações não salvas neste editor serão substituídas pela última versão do rascunho no servidor. Baixe suas alterações antes, se desejar preservá-las."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => setConfirm(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant={confirm?.type === "delete" ? "destructive" : "default"}
              disabled={locked}
              onClick={() => void execute()}
            >
              {busy ? (
                <Loader2 className="animate-spin" />
              ) : confirm?.type === "publish" ? (
                <Send />
              ) : confirm?.type === "delete" ? (
                <Trash2 />
              ) : (
                <History />
              )}
              {confirm?.type === "publish"
                ? "Publicar agora"
                : confirm?.type === "delete"
                  ? "Excluir bloco"
                  : confirm?.type === "restore"
                    ? "Restaurar rascunho"
                    : "Carregar rascunho"}
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
            <DialogTitle>
              {locked ? "Aguarde a operação terminar" : "Sair sem salvar as alterações?"}
            </DialogTitle>
            <DialogDescription>
              {locked
                ? "Uma operação está em andamento. Aguarde para continuar com segurança."
                : "Seu rascunho tem alterações que ainda não foram salvas. Permaneça no editor para salvá-las antes de sair."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => blocker.reset?.()}>
              Continuar editando
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={locked}
              onClick={() => blocker.proceed?.()}
            >
              Descartar alterações e sair
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BackgroundEditor({
  background,
  patch,
  onUploading,
  disabled,
  previewMonth,
  onPreviewMonth,
}: {
  background: LinkTreeContent["background"];
  patch: (background: LinkTreeContent["background"]) => void;
  onUploading: (delta: number) => void;
  disabled: boolean;
  previewMonth: number;
  onPreviewMonth: (month: number) => void;
}) {
  const patchBackground = (next: Partial<LinkTreeContent["background"]>) =>
    patch({ ...background, ...next });
  const monthly = background.monthlyPresets;
  return (
    <details className="rounded-xl border bg-card" open>
      <summary className="cursor-pointer px-5 py-4 text-base font-semibold">
        Fundo da página
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          Tema fixo, calendário mensal ou foto
        </span>
      </summary>
      <div className="space-y-4 border-t p-5">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Como escolher o fundo</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                { value: "fixed", label: "Tema fixo", description: "Um visual o ano inteiro" },
                { value: "monthly", label: "Mudar por mês", description: "Calendário automático" },
                { value: "image", label: "Sua imagem", description: "Uma foto de fundo" },
              ] as const
            ).map((mode) => (
              <label
                key={mode.value}
                className={`cursor-pointer rounded-lg border p-3 ${background.mode === mode.value ? "border-brand bg-brand/5 ring-1 ring-brand" : "hover:border-foreground/30"}`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="links-background-mode"
                    value={mode.value}
                    checked={background.mode === mode.value}
                    onChange={() => patchBackground({ mode: mode.value })}
                    className="size-3.5 accent-brand"
                  />
                  <span className="text-sm font-medium">{mode.label}</span>
                </span>
                <span className="mt-1 block pl-5 text-xs text-muted-foreground">
                  {mode.description}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {background.mode === "fixed" && (
          <label className="block text-sm font-medium">
            Tema do fundo
            <select
              value={background.preset}
              onChange={(event) =>
                patchBackground({ preset: event.target.value as BackgroundPreset })
              }
              className={input}
            >
              {BACKGROUND_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {PRESET_LABELS[preset]}
                </option>
              ))}
            </select>
          </label>
        )}
        {background.mode === "monthly" && (
          <div>
            <h3 className="text-sm font-medium">Calendário de fundos</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Escolha o visual de cada mês. Depois de publicar, a página troca automaticamente no
              início do mês, pelo horário de Fortaleza. Selecionar um mês abaixo também atualiza a
              prévia.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {BACKGROUND_MONTHS.map((month, index) => (
                <label
                  key={month}
                  className={`rounded-lg border p-3 text-xs font-medium ${previewMonth === index + 1 ? "border-brand bg-brand/5" : ""}`}
                >
                  {month}
                  <select
                    aria-label={`Tema de ${month.toLowerCase()}`}
                    value={monthly[index] ?? "brand"}
                    onFocus={() => onPreviewMonth(index + 1)}
                    onChange={(event) => {
                      const values = [...monthly];
                      values[index] = event.target.value as BackgroundPreset;
                      patchBackground({ monthlyPresets: values });
                      onPreviewMonth(index + 1);
                    }}
                    className={`${input} mt-2 px-2 text-xs`}
                  >
                    {BACKGROUND_PRESETS.map((preset) => (
                      <option key={preset} value={preset}>
                        {PRESET_LABELS[preset]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
        )}
        {background.mode === "image" && (
          <>
            <LinkTreeEditorImage
              label="Imagem de fundo"
              value={background.image}
              onChange={(image) => patchBackground({ image })}
              onUploading={onUploading}
              disabled={disabled}
              ratio={9 / 16}
            />
            <p className="text-xs text-muted-foreground">
              Esta imagem cobre o fundo da página. A capa e o logotipo continuam independentes.
            </p>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">
                Sobreposição para facilitar a leitura
              </legend>
              <div className="flex flex-wrap gap-4">
                {(
                  [
                    { value: "light", label: "Clara" },
                    { value: "dark", label: "Escura" },
                  ] as const
                ).map((overlay) => (
                  <label
                    key={overlay.value}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <input
                      type="radio"
                      name="links-background-overlay"
                      checked={background.overlay === overlay.value}
                      onChange={() => patchBackground({ overlay: overlay.value })}
                      className="size-4 accent-brand"
                    />
                    {overlay.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {!background.image && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800">
                Envie a imagem para usar este modo. Enquanto não houver imagem, a prévia mostra o
                tema de fundo já selecionado.
              </p>
            )}
          </>
        )}
      </div>
    </details>
  );
}

function ItemEditor({
  item,
  locations,
  patch,
  onUploading,
  disabled,
  officialUnit,
}: {
  item: LinkTreeItem;
  locations: LinkTreeItem[];
  patch: (patch: Partial<LinkTreeItem>) => void;
  onUploading: (delta: number) => void;
  disabled: boolean;
  officialUnit: boolean;
}) {
  const whatsapp = item.type === "seller" || item.type === "whatsapp";
  const linkedLocation = locations.find((location) => location.id === item.locationId);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {officialUnit && (
        <p className="rounded-lg border bg-muted p-3 text-xs leading-relaxed sm:col-span-2">
          Os dados de contato desta unidade são atualizados pelo cadastro oficial. Foto, descrição,
          mensagem e visibilidade continuam nesta árvore.{" "}
          <a className="text-brand underline" href="/interno/unidades">
            Editar unidade
          </a>
          .
        </p>
      )}
      <label className="text-sm font-medium sm:col-span-2">
        {item.type === "seller"
          ? "Nome do vendedor"
          : item.type === "heading"
            ? "Título do grupo"
            : item.type === "location"
              ? "Nome da unidade"
              : "Título do botão"}
        <input
          value={item.title}
          disabled={officialUnit && item.type === "location"}
          onChange={(event) => patch({ title: event.target.value })}
          required={item.active}
          maxLength={120}
          className={input}
          placeholder={
            item.type === "seller"
              ? "Nome que aparecerá na página"
              : "Como este bloco será apresentado"
          }
        />
      </label>
      <label className="text-sm font-medium">
        Mostrar a partir de
        <input
          type="datetime-local"
          value={item.startsAt}
          onChange={(event) => patch({ startsAt: event.target.value })}
          className={input}
        />
      </label>
      <label className="text-sm font-medium">
        Mostrar até
        <input
          type="datetime-local"
          value={item.endsAt}
          onChange={(event) => patch({ endsAt: event.target.value })}
          className={input}
        />
      </label>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Horários de Fortaleza. Sem datas, o bloco segue apenas a opção de visibilidade.
      </p>
      {item.type !== "location" && item.type !== "heading" && (
        <div className="sm:col-span-2">
          <label className="text-sm font-medium">
            {item.type === "seller" ? "Unidade do vendedor" : "Unidade do link"}
            <select
              value={item.locationId ?? ""}
              onChange={(event) => patch({ locationId: event.target.value || null })}
              className={input}
            >
              <option value="">Equipe geral (sem unidade)</option>
              {locations
                .filter(
                  (location) => !item.active || location.active || location.id === item.locationId,
                )
                .map((location) => (
                  <option
                    key={location.id}
                    value={location.id}
                    disabled={item.active && !location.active}
                  >
                    {location.title || "Unidade sem nome"}
                    {!location.active ? " (oculta)" : ""}
                  </option>
                ))}
            </select>
          </label>
          <p
            className={`mt-2 text-xs ${item.locationId && !linkedLocation?.active ? "text-amber-800" : "text-muted-foreground"}`}
          >
            {!item.locationId
              ? "Este vendedor aparece na equipe geral. Escolha uma unidade para agrupá-lo à equipe da loja."
              : !linkedLocation?.active
                ? "Esta unidade está oculta. Para exibir o vendedor, torne a unidade visível ou escolha outra unidade."
                : `Este vendedor será exibido na equipe de ${linkedLocation.title}.`}
          </p>
          {locations.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Use Adicionar unidade para cadastrar a primeira loja.
            </p>
          )}
        </div>
      )}
      <label className="text-sm font-medium sm:col-span-2">
        {item.type === "seller" ? "Cargo ou especialidade" : "Descrição (opcional)"}
        <textarea
          value={item.description}
          onChange={(event) => patch({ description: event.target.value })}
          maxLength={320}
          rows={2}
          className={area}
          placeholder={
            item.type === "seller"
              ? "Ex.: Consultor de mobiliário corporativo"
              : "Uma explicação curta para o visitante"
          }
        />
      </label>
      {item.type !== "heading" && (
        <div className="sm:col-span-2">
          <LinkTreeEditorImage
            label={item.type === "seller" ? "Foto do vendedor" : "Imagem do bloco"}
            value={item.image}
            onChange={(image) => patch({ image })}
            onUploading={onUploading}
            disabled={disabled}
            ratio={item.type === "location" ? 2 : 1}
          />
        </div>
      )}
      {item.type === "link" && (
        <label className="text-sm font-medium sm:col-span-2">
          Endereço de destino
          <input
            value={item.url}
            onChange={(event) => patch({ url: event.target.value })}
            maxLength={1500}
            required={item.active}
            className={input}
            placeholder="https://... ou /produtos"
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Use um endereço HTTPS ou uma página deste site, como /produtos.
          </span>
        </label>
      )}
      {(item.type === "link" || item.type === "whatsapp") && (
        <label className="text-sm font-medium sm:col-span-2">
          Ícone do botão
          <select
            name="links.item.icon"
            value={item.icon ?? "auto"}
            onChange={(event) => patch({ icon: event.target.value as LinkTreeItem["icon"] })}
            className={input}
          >
            <option value="auto">Automático</option>
            <option value="drive">Pasta / Google Drive</option>
            <option value="catalog">Catálogo</option>
            <option value="youtube">YouTube</option>
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="link">Link</option>
          </select>
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Quando houver uma imagem cadastrada, ela aparece no lugar do ícone.
          </span>
        </label>
      )}
      {(whatsapp || item.type === "location") && (
        <>
          <label className="text-sm font-medium sm:col-span-2">
            {item.type === "location" ? "WhatsApp da unidade (opcional)" : "WhatsApp com DDI e DDD"}
            <input
              type="tel"
              inputMode="tel"
              value={item.phone}
              disabled={officialUnit}
              onChange={(event) => patch({ phone: event.target.value })}
              required={whatsapp && item.active}
              maxLength={30}
              className={input}
              placeholder="+55 85 99861-0074"
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Inclua 55, o DDD e o número completo. Confira se a conta recebe mensagens.
            </span>
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Mensagem inicial (opcional)
            <textarea
              value={item.message}
              onChange={(event) => patch({ message: event.target.value })}
              maxLength={600}
              rows={3}
              className={area}
              placeholder="Olá! Vim pela página de links da MAG e gostaria de atendimento."
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              O visitante poderá editar a mensagem antes de enviar.
            </span>
          </label>
        </>
      )}
      {item.type === "location" && (
        <>
          <label className="text-sm font-medium sm:col-span-2">
            Telefone fixo da unidade (opcional)
            <input
              type="tel"
              inputMode="tel"
              value={item.landline}
              disabled={officialUnit}
              onChange={(event) => patch({ landline: event.target.value })}
              maxLength={30}
              className={input}
              placeholder="+55 85 3122-0506"
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Inclua DDI e DDD. Este número abre uma ligação; o WhatsApp é cadastrado separadamente.
            </span>
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Horário de atendimento
            <input
              value={item.hours}
              disabled={officialUnit}
              onChange={(event) => patch({ hours: event.target.value })}
              maxLength={120}
              className={input}
              placeholder="Ex.: Seg. a sex., 8h às 18h · Sáb., 8h às 12h"
            />
          </label>
          <fieldset disabled={officialUnit} className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium">Cor da unidade</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ACCENTS.map((accent) => (
                <label
                  key={accent.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-xs font-medium focus-within:ring-2 focus-within:ring-brand ${item.accent === accent.value ? "border-brand ring-1 ring-brand/20" : ""}`}
                >
                  <input
                    type="radio"
                    name={`location-accent-${item.id}`}
                    value={accent.value}
                    checked={item.accent === accent.value}
                    onChange={() => patch({ accent: accent.value })}
                    className="sr-only"
                  />
                  <span
                    className="size-4 shrink-0 rounded-full"
                    style={{ backgroundColor: accent.color }}
                  />
                  {accent.label}
                  {item.accent === accent.value && <Check className="ml-auto size-3 text-brand" />}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              A cor ajuda o visitante a reconhecer esta unidade e a equipe vinculada.
            </p>
          </fieldset>
          <label className="text-sm font-medium sm:col-span-2">
            Endereço
            <textarea
              value={item.address}
              disabled={officialUnit}
              onChange={(event) => patch({ address: event.target.value })}
              maxLength={320}
              rows={2}
              className={area}
              placeholder="Rua, número, bairro, cidade e estado"
            />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Google Maps (opcional)
            <input
              type="url"
              value={item.mapUrl}
              disabled={officialUnit}
              onChange={(event) => patch({ mapUrl: event.target.value })}
              maxLength={1500}
              className={input}
              placeholder="https://maps.google.com/..."
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Sem link, o botão Como chegar usa o endereço cadastrado.
            </span>
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Waze (opcional)
            <input
              type="url"
              value={item.wazeUrl}
              disabled={officialUnit}
              onChange={(event) => patch({ wazeUrl: event.target.value })}
              maxLength={1500}
              className={input}
              placeholder="https://waze.com/ul?..."
            />
          </label>
        </>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-3 rounded-lg bg-surface p-3 text-sm sm:col-span-2">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={item.active}
            onChange={(event) => patch({ active: event.target.checked })}
            className="size-4 accent-brand"
          />
          Exibir na página
        </label>
        {item.type !== "heading" && (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={item.highlight}
              onChange={(event) => patch({ highlight: event.target.checked })}
              className="size-4 accent-brand"
            />
            Destacar este bloco
          </label>
        )}
      </div>
    </div>
  );
}
