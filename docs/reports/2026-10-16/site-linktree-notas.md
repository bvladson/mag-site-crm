# Levantamento do site público, conteúdo e árvore de links

Data de referência: 16/10/2026. Fonte desta parte: leitura do código local, sem chamadas às APIs do Omie, sem ler segredos e sem alteração funcional. O responsável pelo relatório consolidado deve cruzar estas capacidades com a release e o conteúdo atuais da VPS. Capacidade implementada não significa que existam registros cadastrados.

Estado agregado informado pela auditoria de leitura da VPS do relatório consolidado, em 16/10/2026 às 11h20 BRT: árvore na versão pública 8, duas unidades ativas e nenhum vendedor ativo, fundo em modo imagem, calendário com 12 seleções guardadas e três imagens cadastradas. Catálogo público com 994 produtos, sincronizado às 04h03, e índice interno completo com 1.587 produtos às 05h20. A tabela de configurações de redes estava vazia: sem sobrescritas no banco, os quatro padrões de `src/config/social.ts` são Manual, inclusive YouTube. Existência de uma chave no servidor não altera sozinha esse modo nem comprova sucesso de integração.

## 1. Papel do site público

O institucional funciona como catálogo consultivo e captação de solicitações. Não há checkout, pagamento pela internet ou compra direta no site. O visitante reúne produtos numa lista de orçamento, informa seus dados e recebe protocolo. A continuidade acontece no painel comercial e, opcionalmente, pelo WhatsApp.

Páginas e origem principal:

| Área | Endereços | Funcionamento e origem |
|---|---|---|
| Início | `/` | Hero, categorias, produtos em pronta entrega, outros destaques, ambientes, soluções corporativas, cultura, redes e chamadas para contato. Produtos vêm do catálogo sincronizado; textos/layout vêm do código. |
| Catálogo | `/produtos`, `/categoria/:slug` | Busca, filtros por categoria/ambiente/pronta entrega, ordenação e paginação de 24 produtos. |
| Produto | `/produto/:slug` | Galeria do próprio SKU, zoom, nome, SKU, categoria, descrição, ficha técnica, selo de disponibilidade, quantidade desejada, adicionar ao orçamento e WhatsApp. |
| Ambientes | `/ambientes`, `/ambientes/:slug` | Sete ambientes com catálogo filtrado: diretoria, operacional, reunião, recepção, call center, home office e educação. Organização e imagens de ambientes em código. |
| Institucional | `/sobre`, `/empresas` | Apresentação, cultura e soluções. Conteúdo em código. |
| Projetos | `/projetos`, `/projetos/:slug` | Estrutura para cases; dados do arquivo `src/data/catalog.ts`. Sem CMS de cases no painel. |
| Blog | `/blog`, `/blog/:slug` | Estrutura de listagem/artigo baseada no arquivo `src/data/catalog.ts`. Sem editor de artigos no painel. |
| Contato | `/contato` | Contatos oficiais e formulário que gera protocolo, grava no banco do site e tenta notificar Comercial por e-mail. |
| Orçamento público | `/orcamento` | Lista de interesse e formulário para solicitar cotação. Não é a mesma entidade do orçamento interno/proposta comercial. |
| Carreiras | `/carreiras`, `/carreiras/vagas/:slug`, `/carreiras/banco-de-talentos` | Vagas do banco próprio e formulários de candidatura/banco de talentos. |
| Redes | `/redes` | Perfis e destaques configurados no painel ou conteúdo sincronizado por worker. |
| Árvore de links | `/links/` | Página independente do catálogo, baseada exclusivamente na última versão publicada pelo administrador. |
| Informações | `/privacidade`, `/termos`, `/cookies` | Páginas de políticas e preferências de cookies. Textos em código. |

Os produtos são distribuídos entre cadeiras, mesas, estações, reunião, recepção, armazenamento, escolar, home office, peças/reposição e outros. As categorias e a associação visual de ambientes são definições do código, não cadastros livres no painel.

Evidências: `src/routes/index.tsx`, `src/components/site/Catalog.tsx`, `src/routes/produto.$slug.tsx`, `src/data/catalog.ts`, `src/routes/ambientes.$slug.tsx`.

## 2. Catálogo, busca e disponibilidade

- O site lê um arquivo de catálogo gerado pelo worker; uma visita não consulta a API do Omie. `src/lib/omie.ts` é a fronteira pública e `src/lib/omie.server.ts` valida/leitura o snapshot.
- As respostas públicas usam lista de campos permitidos. Preço do snapshot é obrigatoriamente `null`: a interface exibe valor sob consulta. Quantidades disponíveis, custos, locais de estoque, reservas e compromissos não são publicados.
- O visitante vê os estados `PRONTA_ENTREGA`, `DISPONIVEL` ou `SOB_CONSULTA`. A quantidade permanece no servidor para ordenar vitrines e em funcionalidades internas autorizadas.
- Se o catálogo ficar velho além do limite configurado, padrão de 30 horas no código, a disponibilidade pública é reduzida para sob consulta. Em falha de recarga, conserva-se o último snapshot válido; sem snapshot, a interface mostra catálogo em atualização.
- A busca roda no navegador sobre o índice resumido: aceita nome, SKU, categoria, marca, linha, cor e ambientes; normaliza acentos e tolera pequenos erros de digitação. Há sugestões de produtos/categorias/ambientes no cabeçalho. Não há serviço externo de busca.
- Fotos vêm do cache local `/catalog-images/...`; URLs externas temporárias do fornecedor não vão para a página. Produto sem foto própria usa placeholder; a galeria nunca usa outro SKU como substituto.
- Os slugs são estáveis por identidade do produto. Endereços antigos possuem redirecionamento 301 para o slug atual.
- A home recebe do servidor listas de slugs ordenadas, intercalando categorias. Isso permite usar quantidade para desempate sem enviá-la ao navegador.

Existe uma camada editorial em `catalog/editorial.json`, processada por `scripts/sync-omie.mjs`: nome comercial, descrição, resumo, SEO, slug, destaques, ficha técnica, prioridade na home etc. **Não foi encontrado editor dessa camada no painel.** `/interno/produtos` é consulta rápida; não equivale a CMS de produtos.

## 3. Jornada pública de orçamento e contato

A lista de orçamento fica no navegador em `localStorage`, chave `mag-quote-v1`, sem dados pessoais nessa lista. Guarda slug e quantidade, suporta até 100 produtos e limita quantidades da interface a 999 por item. Há compatibilidade com listas antigas por identidade de produto. O servidor valida novamente o envio e admite até 100 itens, com limite de quantidade e fusão de duplicatas.

No envio da cotação são solicitados nome, empresa opcional, CNPJ opcional, WhatsApp, e-mail, cidade, UF e mensagem opcional. O navegador envia slugs/quantidades; nome e SKU oficiais são recuperados no servidor. Produtos inexistentes não viram itens arbitrários. O pedido é salvo no banco próprio, recebe protocolo e o sistema tenta enviar notificação ao Comercial. A falha do e-mail não apaga a solicitação. Depois do sucesso, o visitante pode abrir o WhatsApp com o resumo e protocolo.

O contato geral tem fluxo semelhante, com assunto/mensagem. A página informa o protocolo e pode direcionar ao WhatsApp. Há captura de parâmetros de campanha e origem de navegação em `sessionStorage`, anexados aos leads de contato e orçamento. Isso **não é painel de analytics**, nem mede cliques da árvore de links. Embora o comentário do utilitário fale em primeira visita, os parâmetros existentes são substituídos se uma navegação posterior na mesma sessão trouxer novos parâmetros.

Proteções visíveis no código: validação cliente/servidor, campo oculto antispam e limites de frequência. O servidor possui chamada opcional de verificação Turnstile; verificar ativação real com a infraestrutura, sem incluir segredos no relatório. Não afirmar que há widget ativo apenas pela existência dessa função.

Evidências: `src/lib/quote.tsx`, `src/routes/orcamento.tsx`, `src/routes/contato.tsx`, `src/lib/leads.functions.ts` (`submitQuoteRequest`, `submitContactRequest`), `src/lib/utm.ts`.

## 4. Carreiras na visão externa

As vagas vêm do banco do site, não das antigas vagas de demonstração. A listagem pública mostra apenas status publicada e prazo de inscrição ainda vigente. Cada vaga pode apresentar área, localização, modalidade, contrato, jornada, resumo, descrição, responsabilidades, requisitos e diferenciais.

O candidato envia nome, e-mail, WhatsApp/telefone, cidade, LinkedIn opcional, apresentação opcional e currículo PDF de até 5 MB. Na candidatura a uma vaga, o consentimento para aquela vaga é obrigatório; autorização adicional para banco de talentos é opcional e independente. No cadastro direto ao banco, a autorização cobre esse banco.

O servidor verifica novamente se a vaga está aberta. O título/identidade da vaga vêm do banco, e não de texto fornecido pelo navegador. O PDF é verificado pelo conteúdo; o código rejeita marcadores conhecidos de JavaScript, execução, anexos e recursos ativos. O arquivo fica fora da pasta pública com nome aleatório, e o acesso ao currículo é restrito no painel. Esse filtro não deve ser descrito como antivírus completo.

Após gravar, retorna protocolo e tenta notificar DHO. Vaga encerrada preserva o endereço compartilhado com aviso de encerrada, remove formulário de candidatura e sai do sitemap/indexação. Rascunhos não são públicos.

Evidências: `src/lib/careers.server.ts` (`listOpenJobs`, `findPublicJob`, `findOpenJob`, `isOpen`), `src/components/site/ApplicationForm.tsx`, `src/lib/leads.functions.ts` (`submitJobApplication`), rotas de carreiras.

## 5. Redes sociais e conteúdo administrável

O painel `/interno/redes`, exclusivo de administrador nas funções de servidor, administra YouTube, Instagram, TikTok e LinkedIn. Por rede é possível configurar perfil oficial/nome exibido e escolher Manual, API ou Desligada.

- Manual: cadastrar link da publicação, texto, tipo, data, ordem e imagem opcional JPG/PNG/WebP de até 2 MB. Pode ocultar/mostrar, alterar ordem e excluir destaques. Para vídeo do YouTube, sem imagem enviada, o servidor pode buscar a miniatura oficial.
- API: o site lê uma cópia sincronizada por worker. O painel mostra último sucesso, estado/erro, quantidade e conta sincronizada, sem revelar tokens. Se a identidade sincronizada divergir da oficial, o conteúdo da API não é publicado. Confirmar configuração ativa e resultados reais na VPS.
- Desligada: a rede sai das áreas públicas.
- A home seleciona até 3 vídeos do YouTube e até 3 itens de outras redes, ou até 6 sem YouTube. `/redes` permite até 12 itens por rede.
- Cards usam imagens no próprio domínio. Não há widgets/scripts de todas as redes carregados por visita. Vídeo YouTube só abre player interno depois do clique e com consentimento de marketing; sem isso abre na plataforma.

Os perfis iniciais são oficiais configurados em `src/config/social.ts`; as preferências salvas no banco os sobrescrevem. Os quatro padrões de código estão em Manual. Não confundir esse padrão com o estado atual da VPS.

Evidências: `src/lib/social.server.ts`, `src/lib/social-admin.functions.ts`, `src/components/site/Social.tsx`, `src/routes/_authenticated/interno.redes.tsx`, `src/config/social.ts`.

## 6. Árvore de links implementada

Endereço público permanente: `https://magmoveiscorporativos.com.br/links/`. Editor: `/interno/links`. O público lê a última publicação, jamais o rascunho. Alterações, restaurações e imagens novas não alteram a página publicada até uma nova publicação.

### Identidade, blocos e unidades

É possível editar título, subtítulo, logotipo e capa, escolher tema MAG/claro/escuro e manter até 100 blocos. Tipos implementados: link, WhatsApp, vendedor, unidade/endereço e título de seção. Os blocos têm ordem, visibilidade e destaque. O editor permite criar, duplicar inicialmente oculto, mover, ocultar e remover.

Uma unidade tem nome, endereço, Maps, Waze, imagem/fachada, descrição, horário textual, cor de diferenciação, WhatsApp/mensagem e telefone fixo independente. Quando não há link de mapa personalizado, a página gera a pesquisa pelo endereço. O telefone fixo abre ligação; não vira WhatsApp por inferência. Há quatro cores de diferenciação: bordô, azul, verde e âmbar.

Um vendedor possui nome, descrição/função, foto, WhatsApp/mensagem e vínculo opcional à unidade. Sem vínculo, fica na equipe geral. Os contatos públicos são cadastros independentes do perfil interno/identidade Omie; não há publicação automática de dados de funcionários. O servidor impede vínculo com unidade inexistente e impede vendedor ativo em unidade oculta.

Na página pública, as unidades têm cartões próprios e filtro Todas/por unidade. Os vendedores ficam agrupados por unidade, com cores correspondentes; o visitante pode ir de uma unidade para sua equipe. A busca de vendedor por nome/função aparece a partir de cinco vendedores ativos. Há botões de Maps, Waze, ligação, WhatsApp, copiar endereço e compartilhar a árvore. As interações não registram métricas de cliques.

Os dois endereços esperados para validação da publicação real são BR-116 (Travessa Sargento Portugal, 64, Aerolândia, Fortaleza–CE, CEP 60850-520) e Centro (Av. Dom Manuel, 1180, Centro, Fortaleza–CE, CEP 60060-091). O usuário confirmou o fixo do Centro (85) 3122-0506. A presença efetiva destes registros depende do conteúdo publicado no banco e deve ser conferida na VPS.

### Fundos, prévia e publicação

O fundo pode ser um tema fixo, calendário mensal ou imagem própria. O calendário guarda uma seleção de tema para cada um dos 12 meses; o mês segue `America/Fortaleza`. São 13 opções de desenho: marca, verão, carnaval, mulheres, outono, trabalho, junho, inverno, pais, primavera, rosa, azul e Natal. A virada mensal seleciona o tema já publicado; não existe agendamento de campanhas/banners por data.

Na imagem de fundo é possível escolher sobreposição clara ou escura para leitura. Logo, capa e imagem de fundo são independentes. O editor tem prévia responsiva e simulação do mês. A mesma implementação de renderização serve ao editor e à página pública.

O fluxo é editar → salvar rascunho → conferir prévia → publicar mediante confirmação. O código preserva histórico de versões publicadas e impede alteração/exclusão desses snapshots por gatilhos do banco. Restaurar uma versão copia seu conteúdo para o rascunho; depois é preciso publicar para voltar ao ar. O controle de revisão bloqueia sobrescrita quando outra aba salvou primeiro. Existe aviso de saída com alterações não salvas e exportação do rascunho em JSON para recuperar trabalho em conflito.

Há QR code SVG gerado pelo próprio servidor em `/links/qr.svg`, sempre apontando ao endereço permanente. Alterar conteúdo não exige imprimir outro QR. Não há QR personalizado por vendedor/unidade atualmente, nem filtro persistido no URL para compartilhar a seleção da unidade.

### Imagens e acesso

Só administradores podem salvar/publicar/restaurar/enviar fotos; a checagem ocorre no servidor e confirma que a conta continua ativa e com perfil admin. O bloqueio de interface é apenas uma camada adicional.

O editor permite recorte/zoom e preparação da imagem; o servidor aceita JPG/PNG/WebP, máximo 2 MB após preparação, decodifica, rejeita animações, reorienta, reduz para até 1600 pixels por lado e converte em WebP. Os arquivos têm nome UUID e ficam fora da pasta pública genérica.

As imagens de rascunho são acessadas por rota administrativa privada. A rota pública entrega somente imagens referenciadas pela publicação atual em blocos ativos, logo/capa ou fundo em uso. Ao retirar a imagem da publicação, sua URL deixa de responder publicamente. Uma foto de fundo guardada mas não em uso também não é exposta.

Evidências: `src/lib/links.ts`, `src/lib/links.server.ts` (`readPublicLinkTree`, `saveLinkTreeDraftCore`, `publishLinkTreeCore`, `restoreLinkTreeCore`, `uploadLinkImageCore`, `readPublicLinkImage`), `src/lib/links-admin.functions.ts`, `src/components/interno/LinkTreeEditor.tsx`, `LinkTreeEditorImage.tsx`, `src/components/site/LinkTreeView.tsx`, rotas de imagens e QR.

## 7. SEO, desempenho e limites de administração atuais

Há títulos/descrições por página, URL canônica, tags para compartilhamento, dados estruturados Organization/Product/BreadcrumbList e JobPosting em vagas abertas, sitemap dinâmico e URLs antigas de produto redirecionadas. JSON-LD escapa caracteres capazes de fechar a tag de script. Não há oferta/preço estruturado se não há valor público.

A árvore não carrega o catálogo completo, o cabeçalho/rodapé do institucional ou a lista global de redes. Ela usa layout compacto próprio e só o conteúdo publicado. O consentimento de cookies do institucional fica em `localStorage`; não representa por si só uma integração de analytics/pixels. Evitar afirmar que GA/Meta estão ativos sem evidência específica.

Hoje não é um CMS completo. O administrador consegue gerir árvore, redes e operações próprias de outros módulos; ainda dependem de código/arquivos os textos/hero/ordem da home, páginas institucionais, categorias/ambientes, blog, projetos, depoimentos, logos de clientes e os dados globais de contato. A configuração global `src/config/site.ts` ainda tem somente o endereço BR-116. O rodapé e `/contato` usam esse campo; o cadastro de unidades da árvore não é reaproveitado automaticamente nessas áreas. Essa duplicidade é um ponto concreto para unificar na evolução.

Recursos propostos na conversa, **ainda não implementados nesta base**: carrossel de banners clicáveis, arte por formato de tela, catálogo de promoções, preços/descontos promocionais administráveis, agendamento de início/término de campanha, segmentação de campanha por unidade, métricas de cliques, links/QR específicos por vendedor/unidade. A capa atual é imagem estática sem URL de destino própria, e os fundos animados suaves são decoração, não um sistema de banner de campanha.

## 8. Direções para o briefing Lovable

Preservar os contratos reais dos módulos e construir o visual em cima deles. Uma boa evolução reúne: cadastro global único de unidades; diretório público de vendedores com aprovação admin separado de contas de acesso; CMS institucional e editorial de produto; campanhas/banners como entidade própria com rascunho/prévia/publicação e agendamento; catálogo de ofertas com validação comercial; atribuição de campanha até o lead; relatório de cliques sem registrar conversas privadas. Essas são recomendações futuras, não descrição de funcionalidade existente.

Não mover credenciais Omie para o navegador, não substituir a integração por dados mock em produção e não interpretar o arquivo ARQUITETURA.md como prova de Supabase ativo: ele contém instrução legada de Supabase/RLS para leads, enquanto `leads.functions.ts` grava no banco local próprio do site. A implementação e a opção expressa do usuário por banco próprio são as fontes atuais.

## 9. Conferências de estado a fazer na VPS para o consolidado

1. Confirmar tag ativa e se estes arquivos correspondem à release em produção.
2. Contar catálogo publicado e verificar momento/frescor de sincronização sem expor os dados internos.
3. Confirmar versão pública/revisão de rascunho da árvore, número de vendedores/unidades ativos e modo de fundo, sem listar telefones pessoais não publicados.
4. Confirmar os dois endereços nos blocos publicados e que os horários foram de fato cadastrados antes de afirmá-los.
5. Conferir modos atuais das quatro redes e estado agregado do worker; não afirmar API conectada pelo suporte no código.
6. Conferir quantidade agregada de vagas abertas/encerradas/rascunhos e se a produção mantém demo desativado.
7. Confirmar entrega de notificações por e-mail e ativação real de segurança opcional como Turnstile com infraestrutura; não incluir credenciais no relatório.
