import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { PageTitle, useMe, Loading, ErrorState } from "@/components/interno/ui";
import { UsersPanel } from "@/components/interno/UsersPanel";
import { ProposalSettingsPanel } from "@/components/interno/ProposalSettingsPanel";
import { OmieSettingsPanel } from "@/components/interno/OmieSettingsPanel";
import { AuditPanel } from "@/components/interno/AuditPanel";
import { DiscountSettingsPanel } from "@/components/interno/Discounts";
const tabs = [
  { id: "usuarios", name: "Usuários" },
  { id: "emitente", name: "Emitente" },
  { id: "descontos", name: "Descontos" },
  { id: "integracoes", name: "Integrações" },
  { id: "auditoria", name: "Auditoria" },
];
export const Route = createFileRoute("/_authenticated/interno/admin")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: typeof s["tab"] === "string" && tabs.some((t) => t.id === s["tab"]) ? s["tab"] : undefined,
  }),
  component: AdminPage,
});
function AdminPage() {
  const me = useMe(),
    search = Route.useSearch();
  const [selected, setSelected] = useState(search.tab ?? "usuarios");
  if (me.isLoading) return <Loading />;
  const admin = !!me.data?.roles.includes("admin"),
    manager = !!me.data?.roles.includes("gerente");
  if (!admin && !manager) return <ErrorState error={new Error("Forbidden")} />;
  const active = admin ? selected : "descontos";
  return (
    <>
      <PageTitle title="Administração">
        {admin && (
          <div className="flex gap-2 text-xs">
            <Link to="/interno/unidades" className="rounded border bg-card px-3 py-2">
              Unidades
            </Link>
            <Link to="/interno/seguranca" className="rounded border bg-card px-3 py-2">
              Segurança e MFA
            </Link>
          </div>
        )}
      </PageTitle>
      <div
        className="mb-6 flex flex-wrap gap-1 rounded-lg border bg-card p-1"
        role="tablist"
        aria-label="Administração"
      >
        {tabs
          .filter((t) => admin || t.id === "descontos")
          .map((t) => (
            <button
              type="button"
              role="tab"
              id={"admin-tab-" + t.id}
              aria-controls="admin-tab-content"
              aria-selected={active === t.id}
              tabIndex={active === t.id ? 0 : -1}
              key={t.id}
              onClick={() => setSelected(t.id)}
              onKeyDown={(e) => {
                const visible = tabs.filter((tab) => admin || tab.id === "descontos");
                const index = visible.findIndex((tab) => tab.id === active);
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? visible.length - 1
                      : e.key === "ArrowRight"
                        ? (index + 1) % visible.length
                        : e.key === "ArrowLeft"
                          ? (index - 1 + visible.length) % visible.length
                          : -1;
                if (next < 0) return;
                e.preventDefault();
                setSelected(visible[next]!.id);
                requestAnimationFrame(() =>
                  document.getElementById(`admin-tab-${visible[next]!.id}`)?.focus(),
                );
              }}
              className={
                "rounded-md px-4 py-2 text-sm font-medium " +
                (active === t.id ? "bg-brand text-white" : "text-muted-foreground hover:bg-muted")
              }
            >
              {t.name}
            </button>
          ))}
      </div>
      <section role="tabpanel" id="admin-tab-content" aria-labelledby={"admin-tab-" + active}>
        {active === "usuarios" ? (
          <UsersPanel embedded />
        ) : active === "emitente" ? (
          <ProposalSettingsPanel embedded />
        ) : active === "descontos" ? (
          <DiscountSettingsPanel />
        ) : active === "integracoes" ? (
          <OmieSettingsPanel embedded />
        ) : (
          <AuditPanel embedded />
        )}
      </section>
    </>
  );
}
