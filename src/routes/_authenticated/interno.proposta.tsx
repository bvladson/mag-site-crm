import { createFileRoute } from "@tanstack/react-router";
import { ProposalSettingsPanel } from "@/components/interno/ProposalSettingsPanel";
export const Route = createFileRoute("/_authenticated/interno/proposta")({ component: () => <ProposalSettingsPanel /> });
