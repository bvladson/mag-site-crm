import { createFileRoute } from "@tanstack/react-router";
import { CrmProposals } from "@/components/interno/crm/CrmPages";
export const Route = createFileRoute("/_authenticated/interno/crm/propostas")({
  head: () => ({ meta: [{ title: "Propostas — CRM MAG" }] }),
  component: CrmProposals,
});
