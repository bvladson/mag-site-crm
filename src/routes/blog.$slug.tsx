import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { posts } from "@/data/catalog";
import { DemoNote } from "@/components/site/Section";
import { jsonLd } from "@/lib/seo";

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    const post = posts.find((p) => p.slug === params.slug);
    if (!post) throw notFound();
    return { post };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.post.title ?? "Artigo"} — Blog MAG` },
      { name: "description", content: loaderData?.post.excerpt ?? "Artigo do blog MAG." },
      { property: "og:title", content: loaderData?.post.title ?? "Artigo — Blog MAG" },
      { property: "og:description", content: loaderData?.post.excerpt ?? "Artigo do blog MAG." },
      { property: "og:type", content: "article" },
    ],
    links: loaderData ? [{ rel: "canonical", href: `/blog/${loaderData.post.slug}` }] : [],
    scripts: loaderData ? [{ type: "application/ld+json", children: jsonLd({
      "@context": "https://schema.org", "@type": "Article", headline: loaderData.post.title, description: loaderData.post.excerpt,
      publisher: { "@type": "Organization", name: "MAG Móveis Corporativos" },
    }) }] : [],
  }),
  component: PostPage,
});

function PostPage() {
  const { post } = Route.useLoaderData();
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 lg:py-16">
      <nav className="text-xs text-muted-foreground"><Link to="/blog">Blog</Link> / {post.category}</nav>
      <p className="eyebrow mt-5">{post.category} · {post.minutes} min</p>
      <h1 className="mt-2 text-4xl font-semibold leading-[1.02] lg:text-6xl">{post.title}</h1>
      <p className="mt-4 text-lg text-muted-foreground">{post.excerpt}</p>
      <img src={post.image} alt="" className="mt-8 aspect-[16/9] w-full rounded-md object-cover" />
      <p className="mt-8 text-muted-foreground">O conteúdo completo deste artigo será publicado pela equipe MAG.</p>
      <DemoNote>Artigo demonstrativo.</DemoNote>
    </article>
  );
}
