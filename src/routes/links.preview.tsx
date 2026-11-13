import { createFileRoute, redirect, useBlocker } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUser } from "@/lib/auth.functions";
import { getLinkTreeAdmin } from "@/lib/links-admin.functions";
import { getAdminUnits } from "@/lib/units.functions";
import { currentLinkMonth, linkTreeContentSchema, type LinkTreeContent } from "@/lib/links";
import { officialUnitItem } from "@/components/interno/LinkOfficialUnits";
import { LinkTreeView } from "@/components/site/LinkTreeView";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "same-origin",
};

export const Route = createFileRoute("/links/preview")({
  beforeLoad: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/interno/login", headers: privateHeaders });
    if (!user.roles.includes("admin"))
      throw redirect({ to: "/interno", headers: privateHeaders });
  },
  loader: async () => {
    const admin = await getLinkTreeAdmin();
    const units = await getAdminUnits();
    return { content: admin.draft.content, units };
  },
  headers: () => privateHeaders,
  head: () => ({
    meta: [
      { title: "Prévia privada da árvore — MAG" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: LinkTreePreview,
});

function LinkTreePreview() {
  useBlocker({ shouldBlockFn: () => true, enableBeforeUnload: false });
  const data = Route.useLoaderData();
  const [content, setContent] = useState<LinkTreeContent>(data.content);
  const [month, setMonth] = useState(currentLinkMonth);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent ||
        event.data?.type !== "mag:links-preview"
      ) return;
      const result = linkTreeContentSchema.safeParse(event.data.content);
      if (!result.success) return;
      setContent(result.data);
      const nextMonth = event.data.month;
      if (Number.isInteger(nextMonth) && nextMonth >= 1 && nextMonth <= 12)
        setMonth(nextMonth);
    };
    window.addEventListener("message", receive);
    if (window.parent !== window)
      window.parent.postMessage({ type: "mag:links-preview-ready" }, window.location.origin);
    return () => window.removeEventListener("message", receive);
  }, []);
  const previewContent: LinkTreeContent = {
    ...content,
    items: content.items.flatMap((item) => {
      if (item.type !== "location") return [item];
      const unit = data.units.find((entry) => entry.id === item.id);
      return unit ? (unit.active ? [officialUnitItem(unit, item)] : []) : [item];
    }),
  };
  return (
    <div
      onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("a[href]")) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onSubmitCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <LinkTreeView content={previewContent} preview monthOverride={month} />
    </div>
  );
}
