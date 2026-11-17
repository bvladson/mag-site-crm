import { useEffect } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Home, KanbanSquare, MessageCircle, Users, FileText, Plug, Loader2, Monitor, Moon, Sun } from "lucide-react";
import { CrmProvider, useCrm } from "./CrmProvider";
import { CrmDialogs } from "./CrmDialogs";
import { useStoredState } from "./funil-ui";
import "./Crm.css";

const THEMES = [
  ["light", "Claro", Sun],
  ["dark", "Escuro", Moon],
  ["system", "Igual ao sistema", Monitor],
] as const;
type Theme = (typeof THEMES)[number][0];
/**
 * Tema do CRM (Etapa 4): marcado em <html data-crm-theme> só enquanto o CRM está aberto, porque as janelas e menus
 * do CRM abrem fora desta área. As cores escuras valem só dentro de `.mag-crm`; ao sair do CRM, a marca é retirada.
 */
function ThemeControl() {
  const [theme, setTheme] = useStoredState<Theme>("mag-crm-tema", "light", ["light", "dark", "system"]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.dataset["crmTheme"] = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(
    () => () => {
      delete document.documentElement.dataset["crmTheme"];
    },
    [],
  );
  return (
    <div className="crm-theme" role="group" aria-label="Tema do CRM">
      {THEMES.map(([value, label, Icon]) => (
        <button key={value} type="button" aria-pressed={theme === value} aria-label={`Tema: ${label}`} title={label} onClick={() => setTheme(value)}>
          <Icon />
        </button>
      ))}
    </div>
  );
}

const NAV = [
  { to: "/interno/crm", label: "Meu dia", icon: Home },
  { to: "/interno/crm/atendimento", label: "Atendimento", icon: MessageCircle },
  { to: "/interno/crm/funil", label: "Meu funil", icon: KanbanSquare },
  { to: "/interno/crm/clientes", label: "Clientes", icon: Users },
  { to: "/interno/crm/propostas", label: "Propostas", icon: FileText },
] as const;
function Workspace() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname.replace(/\/$/, ""),
  });
  const { counts, limits, busy, canManage } = useCrm();
  return (
    <div className="mag-crm mag-crm-workspace">
      <nav aria-label="Navegação do CRM" className="mag-crm-nav">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: true }}
            aria-current={pathname === to ? "page" : undefined}
          >
            <Icon />
            <span>{label}</span>
            {to === "/interno/crm/atendimento" && counts.unread > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                {counts.unread}
              </span>
            )}
          </Link>
        ))}
        {canManage && (
          <Link
            to="/interno/crm/integracoes"
            activeOptions={{ exact: true }}
            aria-current={pathname === "/interno/crm/integracoes" ? "page" : undefined}
          >
            <Plug />
            <span>Integrações</span>
          </Link>
        )}
        <ThemeControl />
        {busy && (
          <span
            role="status"
            className="flex items-center gap-1 px-2 text-xs text-muted-foreground"
          >
            <Loader2 className="size-3 animate-spin" />
            Salvando…
          </span>
        )}
      </nav>
      {limits.truncated && (
        <p role="status" className="crm-warning border-b px-4 py-2 text-sm">
          Exibindo até {limits.records} registros por área. Use as listas operacionais para
          consultar o histórico completo.
        </p>
      )}
      <Outlet />
      <CrmDialogs />
    </div>
  );
}
export function CrmWorkspace() {
  return (
    <CrmProvider>
      <Workspace />
    </CrmProvider>
  );
}
