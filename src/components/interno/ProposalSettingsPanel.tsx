import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { lerDadosDaProposta, salvarDadosDaProposta } from "@/lib/propostas.functions";
import { Loading, ErrorState, PageTitle, Card } from "@/components/interno/ui";
import { mensagemErro } from "@/components/interno/orcamento";
import { Button } from "@/components/ui/button";
import { validarEmitente } from "@/lib/proposta-regras";

/** Dados institucionais do cabeçalho/rodapé da proposta comercial (só Admin). Valem para as próximas versões geradas. */

type Emitente = Awaited<ReturnType<typeof lerDadosDaProposta>>;
const campo =
  "mt-1 h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus:border-foreground/40";

export function ProposalSettingsPanel({ embedded = false }: { embedded?: boolean }) {
  const fn = useServerFn(lerDadosDaProposta);
  const q = useQuery({ queryKey: ["interno", "proposta-dados"], queryFn: () => fn() });
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} />;
  return <Formulario key={JSON.stringify(q.data)} inicial={q.data} embedded={embedded} />;
}

function Campo({
  rotulo,
  children,
  dica,
}: {
  rotulo: string;
  children: ReactNode;
  dica?: string | undefined;
}) {
  return (
    <label className="block text-sm font-medium">
      {rotulo}
      {children}
      {dica && <span className="mt-1 block text-xs font-normal text-muted-foreground">{dica}</span>}
    </label>
  );
}

function Formulario({ inicial, embedded = false }: { inicial: Emitente; embedded?: boolean }) {
  const salvarFn = useServerFn(salvarDadosDaProposta);
  const qc = useQueryClient();
  const [e, setE] = useState(inicial);
  const [validade, setValidade] = useState(String(inicial.validadeDias));
  const [ocupado, setOcupado] = useState(false);
  const errors = validarEmitente({ ...e, validadeDias: Number(validade) });
  const texto = (
    chave: Exclude<keyof Emitente, "validadeDias">,
    rotulo: string,
    max: number,
    dica?: string,
  ) => (
    <Campo rotulo={rotulo} dica={dica}>
      <input
        className={campo}
        value={e[chave]}
        maxLength={max}
        onChange={(ev) => setE({ ...e, [chave]: ev.target.value })}
      />
    </Campo>
  );
  const salvar = async () => {
    setOcupado(true);
    try {
      await salvarFn({ data: { ...e, validadeDias: Number(validade) } });
      toast.success("Dados da proposta salvos (valem para as próximas versões geradas)");
      await qc.invalidateQueries({ queryKey: ["interno", "proposta-dados"] });
    } catch (err) {
      toast.error(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  };
  return (
    <>
      <PageTitle as={embedded ? "h2" : "h1"} title="Dados da proposta comercial" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,1fr)]">
        <Card title="Cabeçalho e rodapé do PDF">
          <div className="grid gap-3 sm:grid-cols-2">
            {texto("nomeComercial", "Nome comercial *", 80)}
            {texto("razaoSocial", "Razão social", 120)}
            {texto("cnpj", "CNPJ", 20)}
            {texto("inscricaoEstadual", "Inscrição estadual", 30)}
            {texto("site", "Site", 80, "Só o endereço, ex.: magmoveiscorporativos.com.br")}
            {texto("telefone", "Telefone", 30)}
            {texto("whatsapp", "WhatsApp", 30)}
            {texto("email", "E-mail", 120)}
            <Campo
              rotulo="Validade padrão (dias)"
              dica="Usada quando o orçamento não tem validade definida (1 a 90)."
            >
              <input
                className={campo}
                type="number"
                min={1}
                max={90}
                value={validade}
                onChange={(ev) => setValidade(ev.target.value)}
              />
            </Campo>
          </div>
          <div className="mt-3 grid gap-3">
            {texto("endereco", "Endereço", 200)}
            {texto(
              "dadosBancarios",
              "Dados bancários",
              300,
              "Banco, agência, conta e favorecido que podem aparecer no PDF.",
            )}
            {texto("pix", "Chave PIX", 140)}
            <Campo
              rotulo="Texto das condições (opcional)"
              dica="Aparece abaixo de condição de pagamento, previsão e validade. Ex.: frete e montagem conforme indicado."
            >
              <textarea
                className={`${campo} h-20 py-2`}
                maxLength={400}
                value={e.rodape}
                onChange={(ev) => setE({ ...e, rodape: ev.target.value })}
              />
            </Campo>
          </div>
          {!!errors.length && (
            <ul className="mt-3 list-disc pl-5 text-xs text-destructive">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
          <Button className="mt-4" disabled={ocupado || !!errors.length} onClick={salvar}>
            {ocupado ? "Salvando…" : "Salvar dados da proposta"}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            As versões já geradas não mudam: cada uma guarda os dados da hora em que foi gerada.
          </p>
        </Card>
        <aside className="self-start xl:sticky xl:top-24">
          <Card title="Prévia do cabeçalho e condições">
            <div className="rounded-md border bg-white p-5 text-xs text-zinc-700">
              <div className="border-b-2 border-brand pb-4">
                <strong className="text-xl text-brand">MAG</strong>
                <p className="mt-2 font-semibold">{e.nomeComercial}</p>
                <p>{e.razaoSocial}</p>
                <p>
                  CNPJ {e.cnpj}
                  {e.inscricaoEstadual ? ` · IE ${e.inscricaoEstadual}` : ""}
                </p>
                <p className="mt-1">{e.endereco}</p>
                <p>{[e.telefone, e.whatsapp, e.email, e.site].filter(Boolean).join(" · ")}</p>
              </div>
              <h3 className="mt-4 text-sm font-semibold text-brand">PROPOSTA COMERCIAL</h3>
              <p className="mt-3">Validade padrão: {validade || "—"} dias</p>
              {e.dadosBancarios && (
                <p className="mt-2 break-words">Dados bancários: {e.dadosBancarios}</p>
              )}
              {e.pix && <p className="mt-2 break-all">PIX: {e.pix}</p>}
              <p className="mt-3 whitespace-pre-wrap text-zinc-500">{e.rodape}</p>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Prévia dos campos editados. Cliente, itens e totais vêm de cada negociação.
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}
