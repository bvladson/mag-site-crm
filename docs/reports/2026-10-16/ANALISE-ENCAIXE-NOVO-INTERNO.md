# Análise de encaixe do novo painel MAG

**Origem visual:** `C:\Users\VLADSON\Downloads\Site - interno`  
**Sistema operacional atual:** `C:\Users\VLADSON\Downloads\SITE MAGMOVEIS INSTITUCIONAL`  
**Data da análise:** 16/10/2026

## Conclusão

**É possível aproveitar o novo visual no painel atual.** A compatibilidade tecnológica é alta e não exige trocar o banco, reescrever o sistema ou misturar recursos de BIomie/Leantime. A recomendação é incorporar menu, tema, componentes e organização visual nas rotas autenticadas existentes, mantendo os serviços e regras que já funcionam.

O novo código é um protótipo visual declarado. Ele possui dados fictícios em `src/lib/mock.ts`, estado em memória e diversas ações sem conexão com o servidor. Cumpre o papel de apresentar a direção visual; ainda não substitui o painel operacional.

Esta análise instalou dependências e gerou build local do protótipo para inspeção. Não publicou na VPS, não chamou APIs de negócio e não alterou o código funcional do sistema atual. Foram criados apenas documentos de análise e evidências locais.

## 1. Compatibilidade confirmada

| Item | Verificação |
|---|---|
| React | Ambos usam a mesma família 19.2 |
| TanStack Start | Versão declarada igual: 1.168.60 |
| TanStack Router | Versão declarada igual: 1.170.41 |
| Vite / Nitro | Mesmas versões declaradas: 8.1.5 e 3.0.260603-beta |
| TypeScript, Tailwind e componentes | Mesma base tecnológica; 45 componentes UI coincidem byte a byte |
| Dependências comuns de execução | Nenhuma versão declarada diferente entre as presentes nos dois projetos |
| Build Node | Novo projeto compilou com `NITRO_PRESET=node-server` |
| Tipagem | `tsc --noEmit` passou |
| Teste incluído | Um teste de correspondência da rota inicial passou; não é teste do motor |
| Inspeção em navegador | Oito páginas abriram com HTTP 200, sem erros JavaScript observados |

O helper de build Lovable e os lockfiles diferem. O projeto atual também contém `pdf-lib`, `qrcode` e `sharp`, ausentes no novo. Devem ser mantidos os manifestos e arquivos operacionais do sistema atual, acrescentando somente dependências justificadas. Não há necessidade de uma troca integral da estrutura de build para portar o visual.

## 2. O que pode ser aproveitado

- Menu lateral dividido em Geral, Comercial, DHO, Site/Marketing e Administração.
- Cabeçalho de páginas, cards, tabelas, indicadores e apresentação dos estados.
- Paleta, espaçamento e tipografia interna, preservando a identidade do site público.
- Separação visual entre solicitações recebidas e negociações/propostas.
- Navegação da negociação por Cliente, Itens, Condições, Proposta, Envio, Aceite, Revisão Omie e Resultado.
- Funil visual das candidaturas e composição da ficha do candidato.
- Conceito de prévia para celular/computador em conteúdo.

As etiquetas “Motor existente”, “Implementado, desligado” e “Recurso novo” são úteis para discutir o protótipo. Na interface operacional devem dar lugar a estados reais do processo/dados, sem informar implementação técnica desnecessária ao operador.

## 3. Situação de cada módulo

| Módulo | O que o novo código entrega | Como encaixar |
|---|---|---|
| Moldura/menu | Apresentação pronta; perfil simulado; busca e unidade sem efeito | Ligar à sessão real, papéis somáveis, rotas e indicadores existentes |
| Visão geral | Contadores e pendências de arrays fictícios | Reutilizar dashboard atual; criar indicadores novos apenas com consultas definidas |
| Solicitações | Tabela ilustrativa e botão Converter sem ação | Usar a fila real, detalhes, atualização de status e criação de orçamento existentes |
| Negociações | Lista e abas/etapas locais | Conectar CRUD, revisão, proprietário e transições do motor atual |
| Propostas | Versões fixas e botões ilustrativos | Reaproveitar geração/PDF, comparação, envio, recusa e aceite reais |
| Omie | Pré-conferência e bloqueios demonstrativos | Reutilizar revisão e serviço atual; respeitar a configuração real de escrita |
| DHO | Tabela de vagas e funil selecionável | Consultar vagas/candidaturas reais, preservar editor, filtros, notas e PDF privado |
| Árvore | Quatro links fixos, prévia e botões sem operação | Manter o editor completo atual e aplicar o tema novo |
| Campanhas | Cards descritivos de recursos futuros | Implementar modelo, artes, destino, vigência e métricas em etapa própria |
| Administração | Cards sem formulários ou operações | Navegar para usuários, Omie, emitente e demais páginas reais |
| Pedir orçamento | Confirmação simulada em memória | Continuar usando o formulário público real, fora da moldura interna |

## 4. Ajustes necessários antes de produção

### Acesso e dados reais

O novo menu inicia com perfil Admin e permite trocar livremente entre perfis. Isso serve à demonstração. Na adaptação, o perfil vem da sessão real, com autorização no servidor e permissões cumulativas. Não se deve levar o seletor de perfil fictício para operação.

A lista comercial filtra por um nome fixo de consultor; isso não equivale à propriedade real do orçamento. Na inspeção, selecionar Comercial ainda permitiu ver o detalhe fictício de outra consultora. O sistema atual já possui checagem por dono no servidor, que deve ser mantida.

Um ID inexistente de negociação abre um exemplo fixo. A aplicação real precisa devolver registro não encontrado ou acesso negado, sem mostrar uma negociação substituta.

### Funções e cálculos

“Nova negociação”, “Converter”, “Prévia PDF”, “Comparar”, “Marcar como enviada”, “Registrar aceite”, “Nova vaga”, “Publicar” e “Ver versões” ainda não estão conectados no protótipo. Alternar etapa altera a tela, não a situação comercial. As três primeiras etapas compartilham uma tabela de itens; não há editor completo de cliente/condições ali.

A fórmula de desconto do protótipo pode divergir do motor atual em um centavo. Exemplo: item de R$ 1,01 com desconto de 50%; a regra atual calcula R$ 0,50, enquanto a expressão do protótipo arredonda para R$ 0,51. Deve-se reutilizar `calcularItem` e os totais oficiais do sistema, mantendo a conferência no servidor.

O protótipo desenha a soma de quantidades por SKU, mas marca a disponibilidade com valores fictícios. A revisão Omie atual ainda precisa consolidar linhas pelo identificador do produto; isso exige correção/teste no motor, e não é resolvido apenas copiando a tela nova.

### Recursos que o painel atual já tem e precisam permanecer

O editor atual da árvore é mais completo: identidade, capa, fundos mensais/imagem, fotos, unidades, vendedores, WhatsApp, mapas, rascunho, publicação, versões, restauração, privacidade de imagens e conflitos de edição. Substituí-lo por `/conteudo` retiraria funcionalidades.

No DHO, o atual tem cadastro/edição de vagas, filtros de candidaturas, ficha detalhada, notas, finalidade/consentimento, retenção informativa e download privado. O funil novo deve ser uma visão adicional desses registros. Mover uma candidatura para o banco não registra novo consentimento.

Consulta rápida de produtos, contatos, redes sociais, Minha conta e Sair não receberam equivalentes operacionais completos no novo menu. Precisam continuar acessíveis. Configuração Omie, emitente e usuários também não podem ser substituídos por cards sem operação.

### Celular, tema e site público

Em 390 px não foi observado transbordamento horizontal nas páginas testadas. Porém, o menu lateral desaparece e não há menu móvel alternativo. O campo de busca também fica muito estreito. É necessário acrescentar navegação móvel acessível e reorganizar o cabeçalho.

O novo `styles.css` redefine `:root`, `body`, títulos, fontes e cores. Copiá-lo por cima do atual alteraria o institucional público. O novo tema deve ficar limitado ao painel, incluindo diálogos/portais que são renderizados fora da moldura visual.

O novo layout é instalado na raiz `/`, mas o sistema real utiliza essa raiz para o site institucional. A nova moldura precisa entrar sob `/interno`, com login, proteção de rotas e `noindex` preservados. O `__root.tsx` e o middleware de origem/CSRF atuais devem ser mantidos e adaptados pontualmente.

## 5. Mapa de adaptação recomendado

| Protótipo | Destino no sistema real |
|---|---|
| `/` | `/interno` |
| `/leads` | `/interno/orcamentos`, preservando `/interno/contatos` |
| `/negociacoes` | `/interno/orcamentos-internos` |
| `/negociacoes/$id` | Detalhe interno por UUID real; número MAG-Q permanece como identificação visível |
| `/dho` | Visão integrada sobre vagas/candidaturas, com rotas e detalhes atuais preservados |
| `/conteudo` | Editor real em `/interno/links`, mantendo Redes e futuras Campanhas como módulos próprios |
| `/admin` | Administração agrupada com acesso às telas reais de configuração |
| `/solicitar` | Link para `/orcamento` público; sem substituir o formulário real pelo simulador |

Não é necessário renomear todas as URLs existentes. Se uma nova organização de endereços for escolhida, deve prever redirecionamentos e preservar links de atendimento já enviados.

## 6. Sequência de implementação

1. **Moldura interna:** menu lateral, cabeçalho, tema isolado, usuário real, Sair e navegação móvel. Manter páginas e serviços atuais funcionando.
2. **Visão geral e listas:** novos componentes recebendo dados reais; filtros/estados de carregamento, vazio, erro e acesso negado.
3. **Comercial:** adaptar editor e etapas aos contratos atuais de cliente, itens, condições, proposta, envio, aceite e Omie. Preservar histórico, centavos, dono e concorrência.
4. **DHO:** incluir o funil sobre candidaturas reais e reapresentar vagas/ficha/arquivos; agenda e avaliações ficam para implementação própria.
5. **Conteúdo/Administração:** restilizar árvore e configurações completas; incluir funcionalidades omitidas no menu.
6. **Novos módulos:** cadastro global de unidades, atribuição de leads, campanhas, métricas, entrevistas e MFA, cada qual com regras e banco definidos.
7. **Homologação e publicação:** validar perfis, orçamento de outro dono, IDs inexistentes, cálculos, versões, PDFs/currículos, árvore e páginas públicas; gerar backup e release versionada.

Na primeira etapa, grande parte do ganho visual já pode aparecer, mantendo a operação atual. A maior carga adicional está nas funções futuras desenhadas no protótipo que ainda não possuem dados e serviços.

## 7. Validação realizada e limites

Foram executados instalação pelo lockfile, build Node, TypeScript e o único teste de rota incluído. No navegador local, oito páginas responderam 200 sem erros JavaScript observados; quatro páginas foram verificadas em largura de celular. Foram reproduzidos o formulário somente simulado, o fallback de ID inválido e a ausência da checagem de dono no detalhe fictício.

Essas verificações confirmam a qualidade da base para a adaptação e identificam lacunas do protótipo. Não confirmam integração com os dados reais nem substituem testes do motor financeiro, de publicação e de autorização após o encaixe.

Fontes do novo: `src/components/Shell.tsx`, `kit.tsx`, `src/lib/mock.ts`, `src/routes/`, `src/styles.css`, `package.json` e teste de rotas. Fontes do atual: componentes internos, camada de autenticação, server functions comerciais/DHO/árvore, regras financeiras, Dockerfile e configuração de implantação.

As três notas técnicas por área, os logs e as capturas do protótipo acompanham a análise. Nenhuma alteração na VPS foi executada.
