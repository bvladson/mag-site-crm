import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Shell } from "@/components/interno/ui";

export const Route = createFileRoute("/_authenticated/interno")({
  head: () => ({
    meta: [{ title: "Painel interno — MAG" }, { name: "robots", content: "noindex, nofollow" }],
    links: [
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});
