import { createFileRoute } from "@tanstack/react-router";
import { CrmDay } from "@/components/interno/crm/CrmPages";
export const Route = createFileRoute("/_authenticated/interno/crm/")({
  head: () => ({ meta: [{ title: "Meu dia — CRM MAG" }] }),
  component: CrmDay,
});
