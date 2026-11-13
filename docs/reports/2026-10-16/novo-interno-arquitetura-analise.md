# Análise técnica do visual novo do painel MAG

Data: 16/10/2026. Escopo: leitura dos dois códigos locais; esta análise não alterou a aplicação, o banco ou a VPS, nem executou instalação, build ou testes. A validação visual e a execução local são uma frente separada da análise.

## Parecer

É tecnicamente viável aproveitar o novo visual no painel interno existente. As duas fontes usam a mesma base principal: React 19, TanStack Start 1.168.60, TanStack Router 1.170.41, Vite 8.1.5, Nitro 3.0.260603-beta e Tailwind 4. O encaixe recomendado é incorporar componentes de apresentação nas rotas `/interno` existentes e continuar usando o banco, as funções de servidor, a autenticação e as regras atuais.

A pasta `Site - interno` é um protótipo visual. Ela não contém uma implementação nova do motor de negócio. O próprio código identifica dados fictícios e simulação; botões e textos que descrevem recursos não comprovam que esses recursos foram implementados.

Fontes principais: `Site - interno/package.json`, `Site - interno/src/lib/mock.ts`, `Site - interno/src/components/Shell.tsx`, `Site - interno/src/routes/solicitar.tsx`.

## Autenticação e permissões

No protótipo, o perfil começa como `admin` em um `useState` e pode ser trocado livremente nos seletores “Ver como”/“Perfil”. `PerfilCtx` também usa `admin` como valor padrão. Os menus e páginas usam condicionais de interface para aparentar as três áreas. Não há login, cookie de sessão, validação de usuário no servidor ou autorização por registro implementados nessa fonte.

O componente `SemAcesso` afirma que a permissão é conferida no servidor em cada operação, mas essa frase é apenas conteúdo visual: a nova fonte não possui funções de negócio no servidor para efetuar tal verificação. O `src/server.ts` existente é o adaptador HTTP/SSR do framework, não uma API comercial ou de DHO. O middleware CSRF do protótipo também não substitui autenticação.

No sistema atual, a base a preservar inclui:

- `src/routes/_authenticated/route.tsx`: consulta de sessão e redirecionamento para `/interno/login`.
- `src/lib/local-auth-core.server.ts`: hash scrypt, sessões com token armazenado como SHA-256, validade de oito horas, usuário ativo e lista de papéis.
- `src/lib/local-auth.server.ts`: cookie `mag_site_session` com HttpOnly, SameSite e Secure em produção, além de resposta privada sem cache.
- `src/lib/admin.functions.ts`: autorização no servidor por módulo comercial/DHO/admin.
- `src/lib/orcamentos.server.ts`: escopo por proprietário na consulta e leitura de negociações; administrador pode consultar todas.
- `src/lib/links-admin.functions.ts` e `src/lib/links.server.ts`: operações administrativas e revalidação do usuário ativo para publicação e imagens.

Os papéis atuais são somáveis (`roles[]`). O protótipo representa um único perfil por vez (`Perfil` string); importar esse modelo reduziria capacidades legítimas de quem acumula Comercial e DHO. O novo menu deve mostrar os módulos que correspondem a qualquer papel do usuário, obtido pelo `useMe()` atual. O seletor livre de papel deve ficar somente na demonstração, fora do painel real.

Evidências: novo `src/components/Shell.tsx:23`, `:57`, `:71`; novo `src/components/kit.tsx:5`; atual `src/lib/local-auth.server.ts:4`; atual `src/lib/local-auth-core.server.ts:78`; atual `src/lib/orcamentos.server.ts:28` e `:172`.

## Dados e ações: o que a nova fonte realmente faz

| Área nova | Implementação encontrada | Integração necessária |
|---|---|---|
| Visão geral | Contagens calculadas sobre arrays de exemplos | Usar indicadores do servidor, respeitando o papel e a propriedade dos registros |
| Leads | Tabela de `src/lib/mock.ts`; botão Converter sem ação | Conectar solicitações reais e ações existentes; confirmação de duplicidade, responsável e unidades exigem especificação própria |
| Negociações | Lista fictícia; filtro do consultor compara texto “Carlos Consultor” | Preservar a autorização por ID de usuário no servidor |
| Detalhe de negociação | Troca de etapa em `useState`; resumo numérico calculado apenas no navegador | Usar o orçamento real e suas regras de estados, validação, centavos, versão e propriedade |
| Proposta | Botões de PDF, comparação, compartilhamento e aceite sem implementação | Reaproveitar as funções reais de propostas, versões, PDFs e registro de ações |
| Revisão Omie | Checklist fixo e botão desabilitado | Usar a conferência real, o token de revisão e os bloqueios atuais; manter a configuração de escrita vigente |
| Solicitação pública | `preventDefault(); setOk(true)` e mensagem explícita de simulação | Conectar o formulário público existente; não tratar a tela do protótipo como captura real |
| DHO | Vagas e cartões de candidatos fictícios; clique apenas seleciona ficha | Conectar listagem, status, observações e currículos privados; agenda e avaliações são expansão do motor |
| Árvore | Lista fixa e mudança de largura da prévia; publicar e versões sem ação | Preservar o editor real, unidades, vendedores, temas, uploads, rascunhos, publicações e QR |
| Campanhas | Três cartões descrevem a ideia de banners | Exige implementação de dados, agendamento, destino, unidade, publicação e eventualmente cliques |
| Administração | Cartões explicativos de configurações | Ligar às telas reais; cadastro compartilhado de unidades, convites e MFA não surgem apenas com o novo visual |

O único teste incluído no protótipo confirma o reconhecimento da rota `/`, sem renderização e sem loaders. Não valida persistência, regras, autorização, cálculo ou operações comerciais. Fonte: novo `src/test/app-routing.test.tsx`.

O detalhe de negociação procura o ID no array e, se não encontra, mostra uma negociação fixa de exemplo (`negociacoes[1]`). Esse fallback deve ser removido na integração: IDs inexistentes devem produzir estado de registro não encontrado; acesso a registro de outro comercial deve ser recusado no servidor.

## Rotas e proteção do site público

No protótipo, o painel ocupa `/`, `/leads`, `/negociacoes`, `/dho`, `/conteudo`, `/admin` e `/solicitar`. O `__root.tsx` envolve toda a aplicação no novo `Shell`. Copiar essa árvore integralmente para o institucional substituiria a raiz pública e colocaria o painel sobre as páginas públicas.

O ponto de entrada adequado é `src/routes/_authenticated/interno.tsx` e seu `Shell` atual. Manter a navegação real sob `/interno` preserva a home pública, o catálogo, o orçamento público, a árvore `/links/`, os links de PDF e as rotas de imagem. O arquivo `routeTree.gen.ts` deve continuar sendo gerado a partir das rotas finais; não deve ser copiado da demonstração.

Mapeamento recomendado:

| Novo visual | Destino no sistema atual |
|---|---|
| `/` | `/interno` |
| `/leads` | `/interno/orcamentos` e acesso coerente a `/interno/contatos` |
| `/negociacoes` e detalhe | `/interno/orcamentos-internos` e seu detalhe |
| `/dho` | Visão integrada sobre `/interno/vagas` e `/interno/candidaturas` |
| `/conteudo` | `/interno/links`, mantendo também `/interno/redes` |
| `/admin` | Entrada agrupada para usuários, Omie e emitente da proposta |
| `/solicitar` | Link para o formulário público real, fora da moldura do painel |

O protótipo omite acessos que já existem, como consulta rápida de produtos e Minha conta. O menu novo deve acomodar esses recursos e Sair, em vez de encobri-los. As páginas internas atuais possuem `robots: noindex, nofollow`; esse comportamento também precisa permanecer.

## CSS, componentes e navegação

O novo `src/styles.css` altera variáveis globais em `:root`, inclusive `--secondary` de grafite para fundo claro, e troca as fontes de Barlow/Barlow Condensed para IBM Plex Sans/Archivo. Também redefine `body`, títulos, foco e bordas. Copiar essa folha completa mudaria a apresentação do site público e dos componentes compartilhados.

Recomendação: criar um tema exclusivo da moldura interna, com variáveis e tipografia limitadas a uma classe/data attribute do painel, mantendo o tema público atual. Componentes Radix que usam portal fora dessa moldura precisam de contêiner ou classe de tema apropriada para herdar as mesmas cores e fontes. Novas classes semânticas `ok`, `warn`, `info`, `primary-soft` e `sidebar-muted` devem ser acrescentadas de modo compatível às utilidades existentes, sem substituir todo o `@theme`.

Os dois projetos já possuem diversos componentes Radix/shadcn com os mesmos nomes em `src/components/ui`. Reutilizar os componentes atuais e portar apenas alterações justificadas reduz conflitos de API e efeitos colaterais. Os blocos novos `PageHeader`, `Pill`, `Table` e `Card` podem virar componentes internos; devem receber dados e ações como propriedades.

A navegação lateral do protótipo é ocultada abaixo de `md`, sem menu móvel alternativo implementado no `Shell`. O cabeçalho ainda reúne busca, unidade e perfil em uma única linha. É necessário fornecer um menu móvel com abertura/fechamento acessível e adaptar o cabeçalho à largura do celular. A busca e o seletor de unidade atualmente não têm handlers nem afetam listas. Devem ser ligados a funcionalidades reais ou apresentados somente quando houver função implementada.

Fontes: novo `src/styles.css:47` e `:82`; novo `src/components/Shell.tsx:28`, `:67`, `:68`; atual `src/styles.css` e `src/components/interno/ui.tsx`.

## Dependências e publicação

A base compatível evita uma reescrita tecnológica. Há, porém, diferenças que impedem a troca cega de `package.json`/lockfile:

- O protótipo fixa `@lovable.dev/vite-tanstack-config` em 2.26.5; o lock atual fixa 2.24.0. Não é necessário acoplar uma atualização desse pacote à mudança visual.
- O projeto real possui `pdf-lib`, `qrcode` e `sharp`, ausentes do protótipo e usados em funções reais. Substituir o manifesto da aplicação pelos arquivos novos pode remover recursos de PDFs, QR e imagens.
- Vitest e Testing Library aparecem apenas na nova fonte como ferramentas adicionais; são apoio à validação, não parte do motor.
- A infraestrutura real usa imagem Docker com Node 24, Nitro `node-server`, dados persistentes e workers. O protótipo não fornece essa estrutura operacional. Preservar o Dockerfile, deploy, volumes, backups e segredos do institucional.
- O `start.ts` real possui tratamento de origens públicas para CSRF atrás do Nginx; o novo usa apenas a configuração padrão. Manter o arquivo real para evitar regressões em navegadores e proxy HTTPS.

Não foram feitas consultas a bases de vulnerabilidades nem alegações de ausência de vulnerabilidades. Esta revisão trata de integração e comportamento observado no código local.

## Sequência de encaixe recomendada

1. Criar uma versão local/ambiente de revisão com dados separados, sem gravar no banco de produção.
2. Integrar moldura, menu lateral, tema e componentes visuais em `/interno`, com sessão real e navegação móvel completa.
3. Aplicar o visual à visão geral e às listagens usando dados reais e estados de carregamento, erro, vazio e acesso negado.
4. Adaptar o detalhe comercial por blocos, mantendo as regras e funções atuais para salvar, propostas, envio, aceite, revisão Omie e comparação. Etapa visual não pode alterar o estado comercial sem validação.
5. Integrar a visão de recrutamento às vagas e candidaturas atuais, mantendo o arquivo de currículo privado.
6. Manter o editor completo da árvore e acrescentar seu estilo novo; implementar campanhas em uma entrega separada quando tiverem motor e validação reais.
7. Validar três papéis, papéis acumulados, navegação móvel, orçamento de outro proprietário, IDs inexistentes, versão aceita, currículo privado, publicação/restauração da árvore e regressão das páginas públicas.
8. Publicar uma release versionada apenas depois de testar a integração, com backup do banco e uploads e reversão preparada.

## Conclusão da revisão

O visual pode ser aproveitado com bom alinhamento tecnológico. O maior trabalho está em conectar a apresentação nova aos contratos e regras que o sistema atual já possui, completar os controles de interface e implementar separadamente as propostas de recursos novos. O protótipo, sozinho, ainda não substitui o painel operacional.
