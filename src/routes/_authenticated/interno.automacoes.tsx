import { createFileRoute } from "@tanstack/react-router";
import { AutomacoesPanel } from "@/components/interno/AutomacoesPanel";
export const Route = createFileRoute("/_authenticated/interno/automacoes")({ component: () => <AutomacoesPanel /> });
