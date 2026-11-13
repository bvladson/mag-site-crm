/**
 * Respostas prontas do Atendimento (atalho "/" no campo de mensagem).
 * Textos neutros, sem prazo, preço, frete ou condição comercial: esses só entram com os termos reais da MAG
 * aprovados pela gestão comercial. Para mudar, edite esta lista e publique uma nova versão.
 */
export interface QuickReply {
  id: string;
  shortcut: string;
  title: string;
  text: string;
}
export const QUICK_REPLIES: QuickReply[] = [
  {
    id: "saudacao",
    shortcut: "/ola",
    title: "Saudação inicial",
    text: "Olá! Tudo bem? Aqui é da MAG Móveis Corporativos. Como posso ajudar?",
  },
  {
    id: "quantidade",
    shortcut: "/qtd",
    title: "Pedir quantidade",
    text: "Perfeito! Quantas unidades você precisa? Assim preparo o melhor orçamento.",
  },
  {
    id: "medidas",
    shortcut: "/medidas",
    title: "Pedir medidas ou foto do ambiente",
    text: "Se puder, me envie as medidas do ambiente ou uma foto do espaço. Isso ajuda a indicar os modelos ideais.",
  },
  {
    id: "endereco",
    shortcut: "/endereco",
    title: "Pedir endereço de entrega",
    text: "Pode me passar o endereço completo de entrega, com CEP? Assim confirmo frete e prazo para você.",
  },
  {
    id: "dados",
    shortcut: "/dados",
    title: "Pedir dados para o orçamento",
    text: "Para preparar o orçamento, me informe por favor o nome da empresa (ou seu nome completo) e o CNPJ ou CPF.",
  },
  {
    id: "verificar",
    shortcut: "/verificar",
    title: "Vou verificar e retorno",
    text: "Vou verificar essa informação e já te retorno, combinado?",
  },
  {
    id: "orcamento",
    shortcut: "/orcamento",
    title: "Acompanhar orçamento",
    text: "Oi! Conseguiu ver o orçamento que enviei? Fico à disposição para ajustar o que precisar.",
  },
  {
    id: "encerrar",
    shortcut: "/tchau",
    title: "Encerrar atendimento",
    text: "Agradecemos o contato! Qualquer dúvida, é só chamar por aqui. Tenha um ótimo dia!",
  },
];

/** Atalhos que começam com o que foi digitado ("/" sozinho mostra todos). Só vale sem espaço nem quebra. */
export function matchQuickReplies(value: string): QuickReply[] {
  const typed = value.trim().toLowerCase();
  if (!typed.startsWith("/") || /\s/.test(value.trimStart())) return [];
  return QUICK_REPLIES.filter((reply) => reply.shortcut.startsWith(typed));
}
