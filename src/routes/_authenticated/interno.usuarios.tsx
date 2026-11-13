import { createFileRoute } from "@tanstack/react-router";
import { UsersPanel } from "@/components/interno/UsersPanel";
export const Route = createFileRoute("/_authenticated/interno/usuarios")({ component: () => <UsersPanel /> });
