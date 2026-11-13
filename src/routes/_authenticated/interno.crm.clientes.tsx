import { createFileRoute } from "@tanstack/react-router";
import { CrmClients } from "@/components/interno/crm/CrmPages";
export const Route = createFileRoute("/_authenticated/interno/crm/clientes")({
  validateSearch: (search: Record<string, unknown>): { id?: string } =>
    typeof search["id"] === "string" ? { id: search["id"] } : {},
  head: () => ({ meta: [{ title: "Clientes — CRM MAG" }] }),
  component: Page,
});
function Page() {
  const { id } = Route.useSearch();
  return <CrmClients selected={id} />;
}
