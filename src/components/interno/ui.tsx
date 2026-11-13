import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  LayoutDashboard,
  ClipboardList,
  MessagesSquare,
  Users,
  UserCog,
  LogOut,
  Loader2,
  Inbox,
  AlertTriangle,
  KeyRound,
  Briefcase,
  Share2,
  PackageSearch,
  FileText,
  Plug,
  Stamp,
  Link2,
  Menu,
  Search,
  ExternalLink,
  BarChart3,
  CalendarDays,
  Building2,
  Megaphone,
  ShieldCheck,
  Settings,
  GitBranch,
  History,
} from "lucide-react";
import { getMe, type Role } from "@/lib/admin.functions";
import { logout } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { searchPanel } from "@/lib/panel.functions";
import { PANEL_ROLES, ROLE_LABELS } from "@/lib/roles";

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function useMe() {
  const fn = useServerFn(getMe);
  return useQuery({ queryKey: ["interno", "me"], queryFn: () => fn(), staleTime: 60_000 });
}

const ALL: Role[] = [...PANEL_ROLES];
const COM: Role[] = ["admin", "comercial"];
const HR: Role[] = ["admin", "dho"];
const NAV: {
  group: string;
  items: { to: string; label: string; icon: typeof LayoutDashboard; roles: Role[] }[];
}[] = [
  {
    group: "Geral",
    items: [
      { to: "/interno", label: "Visão geral", icon: LayoutDashboard, roles: ALL },
      { to: "/interno/metricas", label: "Métricas", icon: BarChart3, roles: COM },
    ],
  },
  {
    group: "Comercial",
    items: [
      { to: "/interno/crm", label: "CRM comercial", icon: Briefcase, roles: COM },
      {
        to: "/interno/orcamentos",
        label: "Solicitações recebidas",
        icon: ClipboardList,
        roles: COM,
      },
      { to: "/interno/atribuicao", label: "Atribuição de leads", icon: GitBranch, roles: COM },
      {
        to: "/interno/orcamentos-internos",
        label: "Negociações e propostas",
        icon: FileText,
        roles: COM,
      },
      { to: "/interno/produtos", label: "Consulta de produtos", icon: PackageSearch, roles: COM },
      { to: "/interno/contatos", label: "Mensagens do site", icon: MessagesSquare, roles: COM },
    ],
  },
  {
    group: "DHO",
    items: [
      { to: "/interno/vagas", label: "Vagas", icon: Briefcase, roles: HR },
      { to: "/interno/candidaturas", label: "Candidaturas e talentos", icon: Users, roles: HR },
      { to: "/interno/entrevistas", label: "Entrevistas", icon: CalendarDays, roles: HR },
    ],
  },
  {
    group: "Site e marketing",
    items: [
      { to: "/interno/conteudo", label: "Editor do site", icon: Settings, roles: ["admin"] },
      { to: "/interno/links", label: "Árvore de links", icon: Link2, roles: ["admin"] },
      { to: "/interno/campanhas", label: "Campanhas e banners", icon: Megaphone, roles: ["admin"] },
      { to: "/interno/redes", label: "Redes sociais", icon: Share2, roles: ["admin"] },
    ],
  },
  {
    group: "Administração",
    items: [
      {
        to: "/interno/admin",
        label: "Administração e aprovações",
        icon: Settings,
        roles: ["admin", "gerente"],
      },
      { to: "/interno/unidades", label: "Unidades", icon: Building2, roles: ["admin"] },
      { to: "/interno/usuarios", label: "Usuários e perfis", icon: UserCog, roles: ["admin"] },
      { to: "/interno/proposta", label: "Dados da proposta", icon: Stamp, roles: ["admin"] },
      { to: "/interno/omie", label: "Integração Omie", icon: Plug, roles: ["admin"] },
      { to: "/interno/auditoria", label: "Auditoria", icon: History, roles: ["admin"] },
      { to: "/interno/seguranca", label: "Segurança e MFA", icon: ShieldCheck, roles: ALL },
      { to: "/interno/conta", label: "Minha conta", icon: KeyRound, roles: ALL },
    ],
  },
];

export function Shell({ children }: { children: ReactNode }) {
  const me = useMe();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const qc = useQueryClient();
  const end = useServerFn(logout);
  const search = useServerFn(searchPanel);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [showResults, setShowResults] = useState(false);
  const found = useQuery({
    queryKey: ["interno", "search", searchTerm],
    queryFn: () => search({ data: { q: searchTerm } }),
    enabled: searchTerm.length >= 2 && showResults,
  });
  const roles = me.data?.roles ?? [];
  const name = me.data?.displayName || me.data?.email || "Sua conta";
  const initials = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  const roleLabels = roles.map((r) => ROLE_LABELS[r]).join(" · ");
  const visibleGroups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.roles.some((r) => roles.includes(r))),
  })).filter((g) => g.items.length);
  const currentTitle =
    visibleGroups
      .flatMap((g) => g.items)
      .find((i) => path === i.to || (i.to !== "/interno" && path.startsWith(i.to + "/")))?.label ??
    "Painel MAG";
  const signOut = async () => {
    setLeaving(true);
    try {
      await end();
      qc.clear();
      window.location.replace("/interno/login");
    } catch {
      toast.error("Não foi possível encerrar a sessão. Tente novamente.");
      setLeaving(false);
    }
  };
  const brand = (
    <Link
      to="/interno"
      onClick={() => setOpen(false)}
      className="flex items-center gap-2 px-5 py-5 text-lg font-bold tracking-tight"
    >
      <span className="rounded bg-brand px-2 py-0.5 text-white">MAG</span>
      <span>Painel</span>
    </Link>
  );
  const menu = (
    <nav aria-label="Menu principal" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-6">
      {visibleGroups.map((g) => (
        <div key={g.group}>
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">
            {g.group}
          </p>
          {g.items.map(({ to, label, icon: Icon }) => {
            const active = path === to || (to !== "/interno" && path.startsWith(to + "/"));
            return (
              <Link
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`my-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors hover:bg-sidebar-accent ${active ? "bg-sidebar-accent font-semibold text-white shadow-[inset_3px_0_0_var(--brand)]" : "text-sidebar-foreground/85"}`}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
  const profile = (
    <div className="border-t border-sidebar-border p-4">
      <div className="flex items-center gap-2.5">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white"
          aria-hidden
        >
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={name}>
            {name}
          </p>
          <p className="mt-0.5 text-[11px] text-sidebar-muted">{roleLabels}</p>
        </div>
        <button
          type="button"
          onClick={signOut}
          disabled={leaving}
          className="rounded p-2 text-sidebar-muted hover:bg-sidebar-accent hover:text-white disabled:opacity-50"
          aria-label="Sair da conta"
          title="Sair"
        >
          {leaving ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
        </button>
      </div>
    </div>
  );
  return (
    <div className="mag-panel flex min-h-screen bg-surface">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex print:hidden">
        {brand}
        {menu}
        {profile}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-16 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur lg:px-7 print:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 lg:hidden"
                aria-label="Abrir menu"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="flex w-[min(19rem,85vw)] flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
            >
              <SheetTitle className="sr-only">Menu do painel MAG</SheetTitle>
              <SheetDescription className="sr-only">
                Acesse as áreas disponíveis para sua conta.
              </SheetDescription>
              {brand}
              {menu}
              {profile}
            </SheetContent>
          </Sheet>
          <p className="hidden whitespace-nowrap text-sm font-medium xl:block">{currentTitle}</p>
          <div className="relative ml-auto w-full max-w-md">
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                const term = searchText.trim();
                if (term.length >= 2) {
                  setSearchTerm(term);
                  setShowResults(true);
                }
              }}
            >
              <label className="sr-only" htmlFor="panel-search">
                Buscar no painel
              </label>
              <input
                id="panel-search"
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  if (e.target.value.trim().length < 2) setShowResults(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setShowResults(false);
                }}
                placeholder="Buscar no painel…"
                minLength={2}
                maxLength={100}
                className="h-10 w-full rounded-md border bg-muted/50 py-2 pl-3 pr-10 text-sm"
              />
              <button
                type="submit"
                className="absolute inset-y-0 right-0 px-3 text-muted-foreground hover:text-brand"
                aria-label="Pesquisar"
              >
                <Search className="size-4" />
              </button>
            </form>
            {showResults && (
              <section
                aria-label="Resultados da busca"
                className="absolute right-0 top-12 z-40 max-h-[65vh] w-full overflow-y-auto rounded-lg border bg-popover text-popover-foreground shadow-lg"
              >
                <div className="flex items-center justify-between border-b px-3 py-2 text-xs">
                  <span>Resultados para “{searchTerm}”</span>
                  <button onClick={() => setShowResults(false)} className="underline">
                    Fechar
                  </button>
                </div>
                {found.isFetching ? (
                  <p role="status" className="p-4 text-sm">
                    Buscando…
                  </p>
                ) : found.isError ? (
                  <p role="alert" className="p-4 text-sm">
                    Não foi possível buscar.
                  </p>
                ) : !found.data?.length ? (
                  <p className="p-4 text-sm text-muted-foreground">Nenhum registro encontrado.</p>
                ) : (
                  <ul className="divide-y">
                    {found.data.map((r) => (
                      <li key={r.href}>
                        <Link
                          to={r.href}
                          onClick={() => setShowResults(false)}
                          className="block px-4 py-3 hover:bg-muted"
                        >
                          <span className="block truncate text-sm font-medium">{r.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {r.kind} · {r.subtitle}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-brand sm:flex"
          >
            Ver site <ExternalLink className="size-3.5" />
          </a>
        </header>
        <main
          id="panel-main"
          className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 lg:px-7 lg:py-8"
        >
          {me.isLoading ? (
            <Loading />
          ) : me.isError ? (
            <ErrorState error={me.error} />
          ) : roles.length === 0 ? (
            <NoRole />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

function NoRole() {
  return (
    <div className="mx-auto max-w-md rounded-md border bg-card p-6 text-center">
      <h1 className="text-2xl font-semibold">Acesso aguardando liberação</h1>
      <p className="mt-2 text-muted-foreground">
        Sua conta foi criada, mas ainda não tem um perfil (Admin, Comercial ou DHO). Peça a um
        administrador para liberar seu acesso.
      </p>
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" /> Carregando...
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed bg-card py-14 text-center text-muted-foreground">
      <Inbox className="size-6" />
      {children}
    </div>
  );
}
export function ErrorState({ error }: { error?: unknown }) {
  const forbidden = error instanceof Error && error.message.includes("Forbidden");
  const expired = error instanceof Error && error.message.includes("Unauthorized");
  const missing = error instanceof Error && /não encontrad[oa]/i.test(error.message);
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border bg-card py-14 text-center">
      <AlertTriangle className="size-6 text-destructive" />
      <p className="font-medium">
        {forbidden
          ? "Você não tem permissão para acessar esta área."
          : expired
            ? "Sua sessão expirou. Entre novamente."
            : missing
              ? "Registro ou versão não encontrado. Confira o endereço ou volte à lista."
              : "Não foi possível carregar os dados."}
      </p>
      {expired && (
        <Link to="/interno/login" className="mt-2 text-sm font-medium text-brand underline">
          Entrar na conta
        </Link>
      )}
    </div>
  );
}

export function PageTitle({
  title,
  children,
  as: Heading = "h1",
}: {
  title: string;
  children?: ReactNode;
  as?: "h1" | "h2";
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <Heading className="text-3xl font-semibold lg:text-4xl">{title}</Heading>
      {children}
    </div>
  );
}

const tone: Record<string, string> = {
  novo: "bg-brand text-primary-foreground",
  recebida: "bg-brand text-primary-foreground",
  ganho: "bg-success text-primary-foreground",
  aprovada: "bg-success text-primary-foreground",
  finalizado: "bg-success-soft text-success",
  perdido: "bg-muted text-muted-foreground",
  encerrada: "bg-muted text-muted-foreground",
  encerrado: "bg-muted text-muted-foreground",
  entrevista: "bg-success-soft text-success",
  publicada: "bg-success text-primary-foreground",
  rascunho: "bg-accent text-foreground",
  conectado: "bg-success text-primary-foreground",
  desconectado: "bg-muted text-muted-foreground",
  erro: "bg-destructive text-primary-foreground",
};
export function StatusBadge({ s }: { s: string }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-semibold capitalize ${tone[s] ?? "bg-accent text-foreground"}`}
    >
      {s}
    </span>
  );
}

/** Expiração prevista pela política de retenção (LGPD). Sem prazo definido: "a definir". Nada é apagado sozinho. */
export function RetentionDate({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="text-muted-foreground">a definir</span>;
  const expired = new Date(iso).getTime() <= Date.now();
  const day = new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" });
  return (
    <span className={expired ? "font-semibold text-destructive" : undefined}>
      {day}
      {expired ? " · vencida" : ""}
    </span>
  );
}

export function StatusFilter({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {["", ...options].map((o) => (
        <button
          key={o || "all"}
          onClick={() => onChange(o)}
          className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${value === o ? "border-graphite bg-graphite text-graphite-foreground" : "bg-card hover:border-foreground/40"}`}
        >
          {o || "Todos"}
        </button>
      ))}
    </div>
  );
}

export function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 py-2.5">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-words">{v || "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-md border bg-card p-5">
      {title && (
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand">{title}</h2>
      )}
      {children}
    </section>
  );
}

export function StatusEditor({
  status,
  notes,
  options,
  onSave,
}: {
  status: string;
  notes: string | null;
  options: readonly string[];
  onSave: (s: string, n: string) => Promise<unknown>;
}) {
  const [s, setS] = useState(status);
  const [n, setN] = useState(notes ?? "");
  const [saving, setSaving] = useState(false);
  return (
    <Card title="Status">
      <select
        value={s}
        onChange={(e) => setS(e.target.value)}
        className="h-10 w-full rounded-md border bg-card px-3 capitalize"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <label className="mt-3 block text-sm font-medium">
        Observações internas
        <textarea
          value={n}
          onChange={(e) => setN(e.target.value)}
          rows={4}
          maxLength={5000}
          className="mt-1 w-full rounded-md border bg-card p-2"
        />
      </label>
      <Button
        className="mt-3 w-full"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await onSave(s, n);
            toast.success("Salvo");
          } catch {
            toast.error("Não foi possível salvar");
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Salvando..." : "Salvar"}
      </Button>
    </Card>
  );
}

export const tableCls =
  "w-full min-w-[720px] text-sm [&_td]:px-3 [&_td]:py-3 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground [&_tbody_tr]:border-t [&_tbody_tr:hover]:bg-surface";
