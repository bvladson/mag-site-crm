import { createFileRoute } from "@tanstack/react-router";
import { CrmIntegrations } from "@/components/interno/crm/CrmIntegrations";

export const Route = createFileRoute("/_authenticated/interno/crm/integracoes")({
  head: () => ({ meta: [{ title: "Integrações do CRM — MAG" }] }),
  component: CrmIntegrations,
});
