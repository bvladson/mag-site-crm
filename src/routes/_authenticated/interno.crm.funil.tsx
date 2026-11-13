import { createFileRoute } from "@tanstack/react-router";
import { CrmFunnel } from "@/components/interno/crm/CrmPages";
export const Route = createFileRoute("/_authenticated/interno/crm/funil")({
  head: () => ({ meta: [{ title: "Meu funil — CRM MAG" }] }),
  component: CrmFunnel,
});
