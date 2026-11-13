import { Link } from "@tanstack/react-router";
import type { Post } from "@/data/catalog";

export function PostCard({ post, className = "w-[75%] md:w-auto" }: { post: Post; className?: string }) {
  return (
    <Link to="/blog/$slug" params={{ slug: post.slug }} className={`group ${className}`}>
      <div className="overflow-hidden rounded-md bg-surface">
        <img src={post.image} alt="" loading="lazy" className="aspect-[16/11] w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
      </div>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-brand">{post.category}</p>
      <h3 className="mt-1 text-lg font-semibold leading-tight group-hover:underline">{post.title}</h3>
      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{post.excerpt}</p>
      <p className="mt-2 text-xs text-muted-foreground">{post.minutes} min de leitura</p>
    </Link>
  );
}
