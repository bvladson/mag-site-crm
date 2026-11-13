import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getPublicUnits } from "@/lib/units.functions";
import { toast } from "sonner";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { submitQuoteRequest } from "@/lib/leads.functions";
import { readUtm } from "@/lib/utm";
import { Honeypot } from "@/components/site/Honeypot";
import { z } from "zod";
import { Trash2, Minus, Plus, ClipboardList } from "lucide-react";
import { useQuote } from "@/lib/quote";
import { useCatalog } from "@/components/site/CatalogProvider";
import { ProductImage } from "@/components/site/ProductImage";
import { formatPrice } from "@/components/site/ProductCard";
import { Button } from "@/components/ui/button";
import { usePublicSite } from "@/components/site/SiteContentProvider";

export const Route = createFileRoute("/orcamento")({
  head: () => ({
    meta: [
      { title: "Lista de orçamento — MAG Móveis Corporativos" },
      {
        name: "description",
        content: "Reúna os produtos de interesse e solicite uma cotação à equipe MAG.",
      },
      { property: "og:title", content: "Lista de orçamento — MAG" },
      { property: "og:description", content: "Solicite sua cotação de mobiliário corporativo." },
    ],
    links: [{ rel: "canonical", href: "/orcamento" }],
  }),
  component: QuotePage,
});

const schema = z.object({
  nome: z.string().trim().min(2, "Informe seu nome").max(100),
  empresa: z.string().trim().max(120).optional(),
  cnpj: z.string().trim().max(20).optional(),
  whatsapp: z.string().trim().min(10, "Informe um WhatsApp válido").max(20),
  email: z.string().trim().email("E-mail inválido").max(255),
  cidade: z.string().trim().min(2, "Informe a cidade").max(80),
  estado: z.string().trim().min(2, "UF").max(2),
  mensagem: z.string().trim().max(1000).optional(),
  unitId: z.string().uuid().optional(),
});

function QuotePage() {
  const { whatsappUrl, hasWhatsapp } = usePublicSite();
  const products = useCatalog();
  const { items, setQty, remove, clear } = useQuote();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const send = useServerFn(submitQuoteRequest);
  const getUnits = useServerFn(getPublicUnits);
  const units = useQuery({
    queryKey: ["public", "quote-units"],
    queryFn: () => getUnits(),
    staleTime: 60_000,
  });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<{ protocolo: string; text: string } | null>(null);
  const rows = items
    .map((i) => ({ ...i, product: products.find((p) => p.slug === i.slug) }))
    .filter((r) => r.product);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const website = String(fd.get("website") ?? "");
    const data = Object.fromEntries(
      [...fd.entries()].filter(([k, v]) => v !== "" && k !== "website"),
    );
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    const d = parsed.data;
    const lines = rows.map((r) => `${r.qty} × ${r.product!.name} (${r.product!.sku})`).join("\n");
    const text = `Solicitação de cotação\n\n${lines}\n\nNome: ${d.nome}\nEmpresa: ${d.empresa ?? "-"}\nCNPJ: ${d.cnpj ?? "-"}\nWhatsApp: ${d.whatsapp}\nE-mail: ${d.email}\nCidade: ${d.cidade}/${d.estado}\n${d.mensagem ? `Mensagem: ${d.mensagem}` : ""}`;
    setLoading(true);
    try {
      const r = await send({
        data: {
          ...d,
          ...readUtm(),
          website,
          items: rows.map((r) => ({ slug: r.slug, qty: r.qty })),
        },
      });
      setDone({ protocolo: r.protocolo, text: `${text}\nProtocolo: ${r.protocolo}` });
      clear();
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error && err.message.startsWith("Muitas")
          ? err.message
          : "Não foi possível enviar agora. Tente novamente em instantes.",
      );
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <CheckCircle2 className="mx-auto size-10 text-success" />
        <h1 className="mt-4 text-4xl font-semibold">Solicitação enviada!</h1>
        <p className="mt-2 text-muted-foreground">
          Protocolo <b className="text-foreground">{done.protocolo}</b>. Um consultor MAG vai entrar
          em contato em breve.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          {hasWhatsapp && (
            <Button asChild size="lg" variant="whatsapp">
              <a href={whatsappUrl(done.text)} target="_blank" rel="noreferrer">
                <MessageCircle /> Agilizar pelo WhatsApp
              </a>
            </Button>
          )}
          <Button asChild size="lg" variant="outline">
            <Link to="/produtos">Continuar navegando</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <ClipboardList className="mx-auto size-10 text-muted-foreground" />
        <h1 className="mt-4 text-4xl font-semibold">Sua lista está vazia</h1>
        <p className="mt-2 text-muted-foreground">
          Adicione produtos ao orçamento para solicitar uma cotação.
        </p>
        <Button asChild size="lg" className="mt-6">
          <Link to="/produtos">Explorar produtos</Link>
        </Button>
      </div>
    );
  }

  const field =
    "h-11 w-full rounded-md border border-input bg-card px-3 outline-none focus:border-foreground/40";
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 lg:px-6 lg:py-12">
      <h1 className="text-4xl font-semibold lg:text-5xl">Lista de orçamento</h1>
      <div className="mt-8 grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <ul className="divide-y rounded-md border bg-card">
            {rows.map(({ slug, qty, product }) => (
              <li
                key={slug}
                className="grid grid-cols-[72px_minmax(0,1fr)] gap-4 p-4 sm:grid-cols-[88px_minmax(0,1fr)_auto] sm:items-center"
              >
                <ProductImage
                  src={product!.image}
                  alt=""
                  className="aspect-square w-full rounded-md bg-surface object-contain"
                />
                <div className="min-w-0">
                  <Link
                    to="/produto/$slug"
                    params={{ slug }}
                    className="font-semibold hover:text-brand"
                  >
                    {product!.name}
                  </Link>
                  <p className="text-sm text-muted-foreground">{formatPrice(product!.price)}</p>
                </div>
                <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1">
                  <div className="flex items-center rounded-md border">
                    <button
                      onClick={() => setQty(slug, qty - 1)}
                      className="grid size-9 place-items-center"
                      aria-label="Diminuir"
                    >
                      <Minus className="size-4" />
                    </button>
                    <span className="w-10 text-center text-sm font-semibold">{qty}</span>
                    <button
                      onClick={() => setQty(slug, qty + 1)}
                      className="grid size-9 place-items-center"
                      aria-label="Aumentar"
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                  <button
                    onClick={() => remove(slug)}
                    className="grid size-9 place-items-center rounded-md text-muted-foreground hover:text-destructive"
                    aria-label="Remover"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button onClick={clear} className="mt-3 text-sm text-muted-foreground underline">
            Limpar lista
          </button>
        </div>
        <form
          onSubmit={submit}
          className="relative space-y-3 rounded-md border bg-surface p-5 lg:p-6"
          noValidate
        >
          <h2 className="text-2xl font-semibold">Solicitar cotação</h2>
          <Honeypot />
          {(
            [
              ["nome", "Nome"],
              ["empresa", "Empresa"],
              ["cnpj", "CNPJ (opcional)"],
              ["whatsapp", "WhatsApp"],
              ["email", "E-mail"],
            ] as const
          ).map(([n, l]) => (
            <label key={n} className="block text-sm font-medium">
              {l}
              <input name={n} className={`${field} mt-1`} type={n === "email" ? "email" : "text"} />
              {errors[n] && <span className="text-xs text-destructive">{errors[n]}</span>}
            </label>
          ))}
          <div className="grid grid-cols-[1fr_90px] gap-3">
            <label className="block text-sm font-medium">
              Cidade
              <input name="cidade" className={`${field} mt-1`} />
              {errors["cidade"] && (
                <span className="text-xs text-destructive">{errors["cidade"]}</span>
              )}
            </label>
            <label className="block text-sm font-medium">
              Estado
              <input name="estado" maxLength={2} className={`${field} mt-1 uppercase`} />
              {errors["estado"] && (
                <span className="text-xs text-destructive">{errors["estado"]}</span>
              )}
            </label>
          </div>
          <label className="block text-sm font-medium">
            Mensagem
            <textarea
              name="mensagem"
              rows={3}
              className="mt-1 w-full rounded-md border border-input bg-card p-3 outline-none"
            />
          </label>
          {Boolean(units.data?.length) && (
            <label className="block text-sm font-medium">
              Unidade de preferência
              <select name="unitId" className={`${field} mt-1`} defaultValue="">
                <option value="">Sem preferência</option>
                {units.data?.map((u) => (
                  <option value={u.id} key={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                Escolha onde prefere receber o atendimento.
              </span>
            </label>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? "Enviando..." : "Solicitar cotação"}
          </Button>
        </form>
      </div>
    </div>
  );
}
