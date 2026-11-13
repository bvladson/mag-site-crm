import { createFileRoute } from "@tanstack/react-router";
import { CrmWorkspace } from "@/components/interno/crm/CrmWorkspace";
export const Route = createFileRoute("/_authenticated/interno/crm")({
  head: () => ({
    meta: [{ title: "CRM — Painel MAG" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: CrmWorkspace,
});
