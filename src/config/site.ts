/** Dados públicos do cadastro Omie da MAG filial. Campos vazios ficam ocultos. */
export const site = {
  name: "MAG Móveis Corporativos",
  tagline: "Confortavelmente Produtivo!",
  /** WhatsApp comercial oficial (somente dígitos, com DDI 55): (85) 99861-0074 */
  whatsapp: "5585998610074",
  phone: "(85) 3122-0506",
  email: "diretoria@magmoveiscorporativos.com.br",
  address: "Travessa Sargento Portugal, 64, Aerolândia, Fortaleza – CE, CEP 60850-520",
  cnpj: "26.537.584/0003-94",
  hours: "",
  // Redes sociais: configuração explícita em src/config/social.ts (perfis oficiais) e no painel /interno/redes.
  /** Números institucionais: null = aguardando dado oficial */
  stats: [
    { label: "clientes atendidos", value: null as string | null },
    { label: "projetos realizados", value: null as string | null },
    { label: "de mercado", value: null as string | null },
    { label: "produtos disponíveis", value: null as string | null },
  ],
  /** Campanha ativa — defina como null para esconder a seção na Home */
  campaign: null as null | { eyebrow: string; title: string; text: string; cta: string },
};

export const hasWhatsapp = /^55\d{10,11}$/.test(site.whatsapp) && !/^550+$/.test(site.whatsapp);
export const whatsappUrl = (text = "Olá! Vim pelo site da MAG e gostaria de atendimento.") =>
  hasWhatsapp ? `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(text)}` : "/contato";
