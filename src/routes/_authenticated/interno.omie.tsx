import { createFileRoute } from "@tanstack/react-router";
import { OmieSettingsPanel } from "@/components/interno/OmieSettingsPanel";
export const Route = createFileRoute("/_authenticated/interno/omie")({ component: () => <OmieSettingsPanel /> });
