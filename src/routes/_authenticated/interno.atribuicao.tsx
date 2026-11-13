import { createFileRoute } from "@tanstack/react-router";
import { LeadAssignments } from "@/components/interno/LeadAssignments";
export const Route = createFileRoute("/_authenticated/interno/atribuicao")({
  component: () => <LeadAssignments showRules />,
});
