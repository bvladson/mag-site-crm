/**
 * DADOS DE DEMONSTRAÇÃO (MOCK)
 * ---------------------------------------------------------------
 * Todo o conteúdo abaixo é demonstrativo e deve ser substituído por
 * dados oficiais (Omie para produtos/estoque, CMS para conteúdo).
 * Não há preços, certificações, números ou depoimentos inventados:
 * campos sem dado oficial ficam como `null` / placeholder.
 */
import presidente from "@/assets/p-presidente.jpg";
import telada from "@/assets/p-telada.jpg";
import mesa from "@/assets/p-mesa.jpg";
import estacao from "@/assets/p-estacao.jpg";
import armario from "@/assets/p-armario.jpg";
import recepcao from "@/assets/p-recepcao.jpg";
import heroOffice from "@/assets/hero-office.jpg";
import envReuniao from "@/assets/env-reuniao.jpg";
import envOperacional from "@/assets/env-operacional.jpg";
import envRecepcao from "@/assets/env-recepcao.jpg";
import envHome from "@/assets/env-homeoffice.jpg";
import projeto from "@/assets/projeto.jpg";
import team from "@/assets/team.jpg";

export const images = { heroOffice, envReuniao, envOperacional, envRecepcao, envHome, projeto, team };

/** showcase = mobiliário (home, menu e rodapé). Peças e outros ficam só no catálogo e nos filtros. */
export type Category = { slug: string; name: string; image: string; showcase: boolean };
export const categories: Category[] = [
  { slug: "cadeiras", name: "Cadeiras", image: telada, showcase: true },
  { slug: "mesas", name: "Mesas", image: mesa, showcase: true },
  { slug: "estacoes", name: "Estações de trabalho", image: estacao, showcase: true },
  { slug: "reuniao", name: "Reunião", image: envReuniao, showcase: true },
  { slug: "recepcao", name: "Recepção", image: recepcao, showcase: true },
  { slug: "armazenamento", name: "Armazenamento", image: armario, showcase: true },
  { slug: "escolar", name: "Escolar", image: envOperacional, showcase: true },
  { slug: "home-office", name: "Home Office", image: envHome, showcase: true },
  { slug: "pecas", name: "Peças e reposição", image: "/images/product-placeholder.svg", showcase: false },
  { slug: "outros", name: "Outros produtos", image: "/images/product-placeholder.svg", showcase: false },
];
export const showcaseCategories = categories.filter((c) => c.showcase);
export const isShowcaseCategory = (slug: string) => showcaseCategories.some((c) => c.slug === slug);

export type Environment = { slug: string; name: string; tagline: string; image: string };
export const environments: Environment[] = [
  { slug: "diretoria", name: "Diretoria", tagline: "Elegância, presença e conforto executivo.", image: heroOffice },
  { slug: "operacional", name: "Operacional", tagline: "Funcionalidade para equipes e rotina intensa.", image: envOperacional },
  { slug: "reuniao", name: "Sala de reunião", tagline: "Espaços preparados para decisões e colaboração.", image: envReuniao },
  { slug: "recepcao", name: "Recepção", tagline: "Uma primeira impressão que representa sua empresa.", image: envRecepcao },
  { slug: "call-center", name: "Call Center", tagline: "Eficiência e aproveitamento inteligente do espaço.", image: projeto },
  { slug: "home-office", name: "Home Office", tagline: "Conforto profissional dentro de casa.", image: envHome },
  { slug: "educacao", name: "Educação", tagline: "Soluções para escolas, universidades e treinamentos.", image: envReuniao },
];

/** PRONTA_ENTREGA: estoque > limite · DISPONIVEL: estoque > 0 · SOB_CONSULTA: 0 mas comercializado. Inativo no Omie não aparece. */
export type StockStatus = "PRONTA_ENTREGA" | "DISPONIVEL" | "SOB_CONSULTA";
export const stockLabel: Record<StockStatus, string> = { PRONTA_ENTREGA: "Pronta entrega", DISPONIVEL: "Disponível", SOB_CONSULTA: "Consulte disponibilidade" };

export type Product = {
  slug: string;
  sku: string;
  name: string;
  category: string; // category slug
  environments: string[];
  brand: string;
  line: string;
  color: string;
  image: string;
  /** null = "Valor sob consulta" (sem preço oficial cadastrado) */
  price: number | null;
  /** Fotos do PRÓPRIO SKU (nunca de outros produtos). image = capa. */
  images: string[];
  stock: StockStatus;
  featured?: boolean;
  description: string;
  /** Unidade do Omie (UN, CJ, M2...). */
  unit?: string;
  // A quantidade disponível (depósitos comerciais − pedidos − reservas) é só interna (worker, ordenação no servidor,
  // relatórios): desde 05/10/2026 não faz parte dos dados públicos. O cliente vê apenas `stock`.
  /** Momento da sincronização com o Omie que gerou a disponibilidade (ISO). */
  stockUpdatedAt?: string;
  /** Código do produto no Omie (identidade estável; o slug é persistido a partir dele). */
  id?: string | undefined;
  /** Nome original do Omie; `name` pode ser o nome comercial da camada editorial. */
  omieName?: string | undefined;
  /** Camada editorial (catalog/editorial.json) — vazios quando não definidos. */
  shortDescription?: string;
  seoTitle?: string;
  seoDescription?: string;
  highlights?: string[];
  specs?: { label: string; value: string }[];
  homePriority?: number | null;
};

/** Versão leve usada em vitrines, busca e orçamento; a página do produto carrega o restante. */
export type ProductSummary = Omit<Product, "images" | "description" | "stockUpdatedAt" | "omieName" | "shortDescription" | "seoTitle" | "seoDescription" | "highlights" | "specs">;

/** Imagem neutra para SKU sem foto própria (nunca a foto de outro produto). */
export const productPlaceholderImage = "/images/product-placeholder.svg";

const p = (x: Product) => x;
const demoProducts: Product[] = [
  p({ slug: "cadeira-presidente-couro-demo", sku: "DEMO-001", name: "Cadeira Presidente Couro", category: "cadeiras", environments: ["diretoria"], brand: "MAG", line: "Executiva", color: "Preto", image: presidente, images: [presidente], price: null, stock: "PRONTA_ENTREGA", featured: true, description: "Cadeira de espaldar alto para salas de diretoria e presidência." }),
  p({ slug: "cadeira-telada-ergonomica-demo", sku: "DEMO-002", name: "Cadeira Telada Ergonômica", category: "cadeiras", environments: ["operacional", "home-office", "call-center"], brand: "MAG", line: "Ergonômica", color: "Preto", image: telada, images: [telada], price: null, stock: "PRONTA_ENTREGA", featured: true, description: "Encosto em tela para uso diário em escritórios e home office." }),
  p({ slug: "mesa-executiva-nogueira-demo", sku: "DEMO-003", name: "Mesa Executiva Nogueira", category: "mesas", environments: ["diretoria", "home-office"], brand: "MAG", line: "Executiva", color: "Nogueira / Grafite", image: mesa, images: [mesa], price: null, stock: "PRONTA_ENTREGA", featured: true, description: "Mesa com gaveteiro para salas executivas e escritórios." }),
  p({ slug: "estacao-plataforma-4-lugares-demo", sku: "DEMO-004", name: "Estação Plataforma 4 Lugares", category: "estacoes", environments: ["operacional", "call-center"], brand: "MAG", line: "Plataforma", color: "Branco / Grafite", image: estacao, images: [estacao], price: null, stock: "SOB_CONSULTA", featured: true, description: "Estação compartilhada com divisórias para equipes." }),
  p({ slug: "armario-alto-gaveteiro-demo", sku: "DEMO-005", name: "Armário Alto + Gaveteiro", category: "armazenamento", environments: ["operacional", "diretoria"], brand: "MAG", line: "Organize", color: "Grafite", image: armario, images: [armario], price: null, stock: "PRONTA_ENTREGA", description: "Conjunto de armazenamento para documentos e itens pessoais." }),
  p({ slug: "longarina-recepcao-3-lugares-demo", sku: "DEMO-006", name: "Sofá Recepção 3 Lugares", category: "recepcao", environments: ["recepcao"], brand: "MAG", line: "Lobby", color: "Cinza", image: recepcao, images: [recepcao], price: null, stock: "PRONTA_ENTREGA", featured: true, description: "Assento estofado para áreas de espera e recepção." }),
  p({ slug: "cadeira-diretor-telada-demo", sku: "DEMO-007", name: "Cadeira Diretor Telada", category: "cadeiras", environments: ["diretoria", "reuniao"], brand: "MAG", line: "Executiva", color: "Preto", image: telada, images: [telada], price: null, stock: "PRONTA_ENTREGA", description: "Cadeira de média altura para salas de reunião e gestão." }),
  p({ slug: "mesa-operacional-demo", sku: "DEMO-008", name: "Mesa Operacional", category: "mesas", environments: ["operacional", "home-office"], brand: "MAG", line: "Work", color: "Nogueira / Grafite", image: mesa, images: [mesa], price: null, stock: "SOB_CONSULTA", featured: true, description: "Mesa de trabalho para rotinas operacionais." }),
  p({ slug: "gaveteiro-volante-demo", sku: "DEMO-009", name: "Gaveteiro Volante", category: "armazenamento", environments: ["operacional", "home-office"], brand: "MAG", line: "Organize", color: "Grafite", image: armario, images: [armario], price: null, stock: "PRONTA_ENTREGA", description: "Gaveteiro com rodízios para estações e mesas." }),
  p({ slug: "cadeira-presidente-alta-demo", sku: "DEMO-010", name: "Cadeira Presidente Alta", category: "cadeiras", environments: ["diretoria"], brand: "MAG", line: "Executiva", color: "Preto", image: presidente, images: [presidente], price: null, stock: "SOB_CONSULTA", featured: true, description: "Cadeira presidente para ambientes executivos." }),
  p({ slug: "estacao-call-center-demo", sku: "DEMO-011", name: "Estação Call Center", category: "estacoes", environments: ["call-center"], brand: "MAG", line: "Plataforma", color: "Branco / Grafite", image: estacao, images: [estacao], price: null, stock: "PRONTA_ENTREGA", description: "Posições de atendimento com divisórias acústicas." }),
  p({ slug: "sofa-espera-demo", sku: "DEMO-012", name: "Sofá de Espera", category: "recepcao", environments: ["recepcao", "educacao"], brand: "MAG", line: "Lobby", color: "Cinza", image: recepcao, images: [recepcao], price: null, stock: "PRONTA_ENTREGA", description: "Assento para recepções de clínicas, escolas e escritórios." }),
];

export const categoryName = (slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug;

export const megaMenu = {
  Cadeiras: ["Presidente", "Diretor", "Executiva", "Operacional", "Ergonômicas", "Teladas", "Recepção", "Auditório", "Gamer", "Banquetas"],
  "Mesas e mobiliário": ["Mesas executivas", "Mesas operacionais", "Mesas de reunião", "Estações de trabalho", "Gaveteiros", "Armários", "Estantes"],
  Ambientes: ["Diretoria", "Escritórios", "Call Center", "Recepção", "Reunião", "Home Office", "Escolas", "Clínicas", "Auditórios"],
};

export type Case = { slug: string; company: string; type: string; city: string; summary: string; image: string; before: string };
const demoCases: Case[] = [
  { slug: "case-demo-escritorio", company: "Cliente (demonstração)", type: "Escritório completo", city: "Cidade / UF", summary: "Planejamento, fornecimento e montagem de estações e salas de reunião.", image: envOperacional, before: projeto },
  { slug: "case-demo-diretoria", company: "Cliente (demonstração)", type: "Diretoria", city: "Cidade / UF", summary: "Renovação do mobiliário executivo e da sala de reunião da diretoria.", image: heroOffice, before: projeto },
  { slug: "case-demo-recepcao", company: "Cliente (demonstração)", type: "Recepção", city: "Cidade / UF", summary: "Nova recepção com assentos de espera e balcão de atendimento.", image: envRecepcao, before: projeto },
];

export type Post = { slug: string; category: string; title: string; excerpt: string; minutes: number; image: string };
const demoPosts: Post[] = [
  { slug: "como-escolher-cadeira-de-escritorio", category: "Cadeiras", title: "Como escolher a cadeira certa para o escritório", excerpt: "Regulagens, apoio lombar e uso diário: o que observar antes de comprar.", minutes: 6, image: telada },
  { slug: "nr-17-mobiliario", category: "NR-17", title: "NR-17 e mobiliário: o que sua empresa precisa saber", excerpt: "Um resumo prático sobre ergonomia no posto de trabalho.", minutes: 8, image: envOperacional },
  { slug: "planejar-escritorio", category: "Planejamento", title: "Planejamento de escritório em 5 etapas", excerpt: "Do levantamento da equipe à montagem final dos ambientes.", minutes: 7, image: projeto },
  { slug: "sala-de-reuniao-funcional", category: "Ambientes", title: "Sala de reunião que funciona de verdade", excerpt: "Mesa, cadeiras e circulação para reuniões mais produtivas.", minutes: 5, image: envReuniao },
];

export type Job = { slug: string; title: string; area: string; location: string; type: string; summary: string };
/** Vagas demonstrativas — substituir pelas vagas reais do DHO. */
const demoJobs: Job[] = [
  { slug: "consultor-comercial-demo", title: "Consultor(a) Comercial", area: "Comercial", location: "Cidade / UF", type: "Presencial", summary: "Atendimento consultivo a empresas e clientes finais." },
  { slug: "montador-moveis-demo", title: "Montador(a) de Móveis", area: "Operações", location: "Cidade / UF", type: "Presencial", summary: "Montagem e instalação de mobiliário em clientes." },
  { slug: "analista-marketing-demo", title: "Analista de Marketing", area: "Marketing", location: "Cidade / UF", type: "Híbrido", summary: "Conteúdo, redes sociais e campanhas da marca." },
];

export type Social = { id: string; kind: "post" | "reel"; caption: string; image: string; url: string };
const demoInstagram: Social[] = [
  { id: "ig1", kind: "reel", caption: "Bastidores de uma montagem", image: projeto, url: "https://instagram.com/magmoveiscorporativos" },
  { id: "ig2", kind: "post", caption: "Cadeira telada em destaque", image: telada, url: "https://instagram.com/magmoveiscorporativos" },
  { id: "ig3", kind: "post", caption: "Diretoria entregue", image: heroOffice, url: "https://instagram.com/magmoveiscorporativos" },
  { id: "ig4", kind: "reel", caption: "Nosso time", image: team, url: "https://instagram.com/magmoveiscorporativos" },
  { id: "ig5", kind: "post", caption: "Sala de reunião", image: envReuniao, url: "https://instagram.com/magmoveiscorporativos" },
  { id: "ig6", kind: "post", caption: "Recepção nova", image: envRecepcao, url: "https://instagram.com/magmoveiscorporativos" },
];
const demoTiktok: Social[] = [
  { id: "tt1", kind: "reel", caption: "Teste de regulagens", image: telada, url: "#" },
  { id: "tt2", kind: "reel", caption: "Antes e depois", image: projeto, url: "#" },
  { id: "tt3", kind: "reel", caption: "Um dia na MAG", image: team, url: "#" },
  { id: "tt4", kind: "reel", caption: "Home office ideal", image: envHome, url: "#" },
];
const demoYoutube: Social[] = [
  { id: "yt1", kind: "post", caption: "Como montamos um escritório completo", image: envOperacional, url: "#" },
  { id: "yt2", kind: "post", caption: "Guia de cadeiras corporativas", image: presidente, url: "#" },
  { id: "yt3", kind: "post", caption: "Tour pela MAG", image: team, url: "#" },
];

/**
 * Conteúdo demonstrativo só aparece com VITE_SHOW_DEMO=true.
 * Em produção, listas vazias => a seção correspondente não é renderizada.
 */
export const showDemo = import.meta.env['VITE_SHOW_DEMO'] === "true";
export const demoCatalog: Product[] = showDemo ? demoProducts : [];
export const posts: Post[] = showDemo ? demoPosts : [];
export const cases: Case[] = showDemo ? demoCases : [];
export const jobs: Job[] = showDemo ? demoJobs : [];
export const instagram: Social[] = showDemo ? demoInstagram : [];
export const tiktok: Social[] = showDemo ? demoTiktok : [];
export const youtube: Social[] = showDemo ? demoYoutube : [];
export type Testimonial = { quote: string; name: string; role: string };
/** Depoimentos reais (vazio = seção oculta). */
export const testimonials: Testimonial[] = [];
/** Logos reais de clientes (vazio = seção oculta). */
export const clientLogos: { name: string; logo: string }[] = [];
