import { createFileRoute } from "@tanstack/react-router";
import { HomeContent } from "@/components/site/HomeContent";
import { homeShowcase } from "@/lib/omie";
import { getSocialHome } from "@/lib/social.functions";
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ property: "og:url", content: "https://magmoveiscorporativos.com.br/" }],
    links: [{ rel: "canonical", href: "https://magmoveiscorporativos.com.br/" }],
  }),
  loader: async () => {
    const [showcase, social] = await Promise.all([homeShowcase(), getSocialHome()]);
    return { showcase, social };
  },
  component: Home,
});
function Home() {
  const { showcase, social } = Route.useLoaderData();
  return <HomeContent showcase={showcase} social={social} />;
}
