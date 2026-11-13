import { createFileRoute } from "@tanstack/react-router";
import { CrmInbox } from "@/components/interno/crm/CrmPages";
export const Route = createFileRoute("/_authenticated/interno/crm/atendimento")({
  validateSearch: (search: Record<string, unknown>): { c?: string; o?: string } => ({
    ...(typeof search["c"] === "string" ? { c: search["c"] } : {}),
    ...(typeof search["o"] === "string" ? { o: search["o"] } : {}),
  }),
  head: () => ({ meta: [{ title: "Atendimento — CRM MAG" }] }),
  component: Page,
});
function Page() {
  const { c, o } = Route.useSearch();
  return <CrmInbox selected={c} selectedOpportunity={o} />;
}
