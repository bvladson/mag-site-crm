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
    <article className="mag-article mx-auto max-w-4xl px-6 py-12 lg:py-24">
      <nav className="text-xs text-muted-foreground"><Link to="/blog">Blog</Link> / {post.category}</nav>
      <p className="technical-label mt-8 text-muted-foreground">{post.category} · {post.minutes} min</p>
      <h1 className="display-title mt-5">{post.title}</h1>
      <p className="mt-4 text-lg text-muted-foreground">{post.excerpt}</p>
      <img src={post.image} alt="" className="mt-12 aspect-[16/9] w-full object-cover" />
      <p className="mt-8 text-muted-foreground">O conteúdo completo deste artigo será publicado pela equipe MAG.</p>
      <DemoNote>Artigo demonstrativo.</DemoNote>
    </article>
  );
}
