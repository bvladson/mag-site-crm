import { createFileRoute } from "@tanstack/react-router";
import { AuditPanel } from "@/components/interno/AuditPanel";
export const Route = createFileRoute("/_authenticated/interno/auditoria")({ component: () => <AuditPanel /> });
