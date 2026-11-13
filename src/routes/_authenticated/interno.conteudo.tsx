import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getSiteContentAdmin } from "@/lib/site-content-admin.functions";
import { ErrorState, Loading, useMe } from "@/components/interno/ui";
import { SiteContentEditor } from "@/components/interno/SiteContentEditor";

export const Route = createFileRoute("/_authenticated/interno/conteudo")({
  head: () => ({ meta: [{ title: "Editor do site — Painel MAG" }] }),
  component: SiteEditorPage,
});

function SiteEditorPage() {
  const me = useMe();
  const load = useServerFn(getSiteContentAdmin);
  const allowed = me.data?.roles.includes("admin") ?? false;
  const query = useQuery({
    queryKey: ["interno", "site-content"],
    queryFn: () => load(),
    enabled: allowed,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  if (me.isLoading) return <Loading />;
  if (!allowed) return <ErrorState error={new Error("Forbidden")} />;
  if (query.isLoading) return <Loading />;
  if (!query.data) return <ErrorState error={query.error} />;
  return <SiteContentEditor initial={query.data} onRefresh={() => query.refetch()} />;
}
