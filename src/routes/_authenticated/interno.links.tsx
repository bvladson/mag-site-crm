import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getLinkTreeAdmin } from "@/lib/links-admin.functions";
import { ErrorState, Loading, useMe } from "@/components/interno/ui";
import { LinkTreeEditor } from "@/components/interno/LinkTreeEditor";
import { MarketingMetrics } from "@/components/interno/MarketingMetrics";

export const Route = createFileRoute("/_authenticated/interno/links")({
  head: () => ({ meta: [{ title: "Árvore de links — Painel MAG" }] }),
  component: LinkTreeAdmin,
});

function LinkTreeAdmin() {
  const me = useMe();
  const load = useServerFn(getLinkTreeAdmin);
  const allowed = me.data?.roles.includes("admin") ?? false;
  const query = useQuery({
    queryKey: ["interno", "link-tree"],
    queryFn: () => load(),
    enabled: allowed,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  if (me.isLoading) return <Loading />;
  if (!allowed) return <ErrorState error={new Error("Forbidden")} />;
  if (query.isLoading) return <Loading />;
  if (!query.data) return <ErrorState error={query.error} />;
  return (
    <>
      <LinkTreeEditor
        initial={query.data}
        onRefresh={() => query.refetch()}
        summary={<MarketingMetrics compact />}
      />
    </>
  );
}
