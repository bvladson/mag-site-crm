import { createFileRoute } from "@tanstack/react-router";
import { SaudePanel } from "@/components/interno/SaudePanel";
export const Route = createFileRoute("/_authenticated/interno/saude")({ component: () => <SaudePanel /> });
