# Briefing de evolução — Sistema MAG

Este briefing acompanha o relatório factual de 16/10/2026. Ele descreve o trabalho futuro desejado. Não representa autorização para substituir dados, criar pedidos reais no Omie ou publicar um protótipo sobre a produção.

## Como apresentar o projeto

Use o projeto original da MAG quando ele for identificado e estiver reconciliado com a release da VPS. A pasta atual tem origem/template Lovable, mas a sincronização ativa não está comprovada. O Git sync é um vínculo de projeto/repositório/branch; não presumir que importar um ZIP irá reconstruí-lo automaticamente. Se a finalidade inicial for apenas explorar o visual, usar um protótipo separado com dados fictícios identificados.

Anexar `RELATORIO-SISTEMA-MAG.pdf` ou a versão Markdown. Colar o conteúdo de `CONHECIMENTO-PROJETO-LOVABLE.md` em Project Knowledge. As notas por módulo são anexos técnicos para aprofundamento.

## Prompt inicial — diagnóstico, estrutura visual e motor

```text
Quero evoluir o sistema existente da MAG Móveis Corporativos.

Leia o relatório factual anexo e o conhecimento deste projeto antes de propor mudanças. Trabalhe em português do Brasil. Diferencie claramente: existente em produção, implementado porém desligado, e novo recurso proposto.

O sistema atual é React 19 + TypeScript + TanStack Start/Router + Tailwind, servidor Node 24/Nitro em Docker e banco próprio SQLite na VPS. Site e painel são da mesma aplicação. BIomie e Leantime são aplicações independentes. Há autenticação própria com perfis Admin, Comercial e DHO. A arquitetura atual não usa Supabase para os dados de operação.

Objetivo: melhorar a experiência visual e a organização do motor, aproveitando as regras e os dados existentes. Desenvolva uma estrutura coerente para Site e Marketing, Comercial, Orçamentos/Propostas, DHO e Administração.

Na primeira entrega, apresente:
1. Mapa de navegação e inventário de telas por perfil.
2. Design system responsivo da MAG: componentes, tipografia, cores, tabelas, formulários, estados vazios, erros, carregamento e acessibilidade.
3. Fluxos navegáveis dos operadores e do visitante.
4. Modelo de domínio atual e proposta de evolução, com entidades, relacionamentos, estados e responsabilidades.
5. Quais dados e contratos já existem e quais exigem novas funções/tabelas/migrações.
6. Plano em etapas com critérios de aceite e dependências reais.

Seus arquivos precisam corresponder à base real antes da integração. Não reescreva automaticamente backend, autenticação ou banco para adequar o projeto à prévia do Lovable. Se o runtime customizado não funcionar nessa prévia, explicite a limitação e use dados fictícios apenas no protótipo visual, mantendo os contratos para conexão posterior na VPS.

Preserve: cálculos em centavos no servidor, permissão por dono do orçamento, histórico de versões, aceite associado à proposta vigente, privacidade de currículos/PDFs/imagens de rascunho, idempotência de pedidos e leitura do catálogo sincronizado. Operações do painel são server functions TanStack, não uma API REST pública genérica.

Não simplifique os seguintes pontos:
- Solicitação pública de orçamento é lead; orçamento interno é negociação com preço; proposta é uma versão documental. São entidades diferentes.
- Comercial vê a fila compartilhada de leads, mas só os próprios orçamentos internos. Admin vê todos; DHO não lê comercial.
- DHO administra recrutamento e currículos privados. Comercial não lê candidaturas.
- Abrir WhatsApp/e-mail inicia compartilhamento; não comprova envio/aceite. O aceite hoje é registrado internamente.
- Escrita Omie está desligada. Frete, montagem e desconto geral aparecem no PDF, mas bloqueiam a conversão hoje.
- A árvore tem duas unidades e publicação versionada; não há banners, campanhas agendadas ou métricas de cliques ainda.
- Unidades da árvore, dados globais do site e emitente da proposta ainda não são um cadastro único.

Antes de detalhar a implementação, proponha a solução visual e a solução do motor em partes ligadas entre si. Não apresente botões conectados a dados fictícios como funções integradas em produção. Não conecte APIs ou envie comunicações reais durante o protótipo.
```

## Entrega visual esperada

| Área | Telas / experiências desejadas | Dependência do motor |
|---|---|---|
| Navegação | Menu lateral por área, visão por perfil, contexto da unidade e busca | RBAC existente; unidade global ainda precisa de modelagem |
| Visão geral | Pendências, próximas ações e indicadores com período | Contadores básicos existem; agenda, SLA e métricas novas precisam de dados |
| Comercial | Entrada de leads, contatos, responsável, origem, negociação vinculada e histórico | Relacionamento parcial existe; atribuição/tarefas/sincronização são novos |
| Negociação | Cliente, itens, condições, totais e etapa atual em um fluxo claro | CRUD, estados e cálculos existentes |
| Proposta | Prévia, versão vigente, comparação, envio, recusa, aceite e revisão | Preservar snapshots/regras; portal de aceite e arquivo final são novos |
| Omie | Pré-conferência de cliente, vendedor, conta, estoque e extras; resultado legível | Reutilizar motor; escrita só após homologação separada |
| DHO | Lista/funil, ficha do candidato, vaga, currículo, finalidade, agenda e avaliação | Vagas/inscrições existem; agenda/avaliações/responsáveis são novos |
| Conteúdo | Editor de páginas/blocos, produtos editoriais, mídia por SKU, prévia/publicação | CMS institucional/editorial administrativo ainda precisa ser criado |
| Árvore | Editor com celular/computador, unidades/equipes, organização de links | Reutilizar editor, imagens protegidas e versões existentes |
| Campanhas | Banners, destinos, vigência, unidade, catálogo de ofertas e cliques | Novo módulo, sem preço/promessa de estoque inferidos |
| Administração | Unidades, acesso, emitente, integração, notificações e auditoria | Parte existente; unificação, convites, MFA e linha do tempo são evoluções |

## Prompt de aprofundamento — Comercial e propostas

```text
Desenhe o Comercial preservando três entidades: solicitação do site, negociação/orçamento interno e versões de proposta.

Mostre entrada do lead, responsável, próximos passos e negociações vinculadas. Na negociação, apresente Cliente → Itens → Condições → Proposta → Envio → Aceite → Revisão Omie → Resultado. Distinga proprietário comercial de executor de uma ação.

Preserve preço digitado pela equipe, cálculo em centavos no servidor, descontos por item, extras da proposta e controle de revisão. Preserve a versão vigente e proteja versões enviadas/aceitas. Abrir compartilhamento não marca enviada automaticamente. Não crie aceite público/assinatura como se já existissem.

No motor, proponha: evitar conversão duplicada involuntária do lead; somar estoque por produto quando o SKU se repetir; atividades e histórico de estados; contratos claros; política de aprovação de desconto a ser definida pela MAG. Mantenha frete/desconto geral/montagem bloqueados na conversão Omie conforme a regra atual até decisão e homologação. A escrita continua desligada.
```

## Prompt de aprofundamento — DHO

```text
Organize recrutamento com Vagas, Candidaturas, Banco de talentos e futura Agenda/Entrevistas. Reutilize as entidades atuais e preserve currículo privado, consentimento e vínculo da vaga.

Crie proposta visual de tabela e funil acessíveis, ficha com Perfil, Currículo, Interações, Avaliações e Finalidade/Retenção. Indique quais abas dependem de modelo novo. O status banco de talentos não representa novo consentimento; não altere finalidade automaticamente ao arrastar um cartão. A abertura da vaga hoje não agenda publicação; o encerramento por prazo já limita inscrições.

Defina entidades para responsável, entrevista, avaliação e linha do tempo. Trate retenção como política configurável ainda não definida, com fluxo de revisão/descarte explícito. Não implemente exclusão automática ou publique dados de candidatos no protótipo.
```

## Prompt de aprofundamento — Site, árvore e campanhas

```text
Proponha um cadastro único de unidades para o site e uma política clara para a relação com emitentes/negociações. Centro e BR-116 são unidades de atendimento; não presuma que escolher uma determina CNPJ ou contexto fiscal sem definição da MAG.

Crie um CMS de conteúdo institucional e de produto editorial com prévia e publicação. Preserve produtos e fotos do próprio SKU vindos do catálogo sincronizado. Não publique preços, custo, quantidade exata de estoque ou produtos internos ocultos.

Na árvore, preserve URL/QR atuais, rascunhos, versões, unidades e vendedores. Acrescente proposta de campanhas com até três banners leves, artes para celular/computador, título, botão, destino validado, unidade, ordem e vigência. Movimento por transição de interface, com pausa, teclado e redução de movimento. Imagens futuras/retiradas não devem ficar públicas só porque já foram enviadas.

O banner poderá levar a coleção de campanha, produto/categoria, catálogo externo ou WhatsApp identificado. PDF é uma opção adicional que exige upload/validação novos; o upload atual só aceita imagens. Promoções terão produtos e condições comerciais aprovados. Preço promocional não deve ser inferido de campos privados do Omie.

Proponha cliques agregados por campanha, unidade e vendedor, com definição de cada indicador. Clique em WhatsApp não deve aparecer como venda confirmada. Links personalizados/QR por unidade ou vendedor são novos recursos, preservando o QR permanente já distribuído.
```

## Entregas do motor a exigir depois do desenho

1. Contratos tipados e mapa de autorização para cada operação.
2. Plano de migrações que preserve IDs, vínculos, versões e arquivos existentes.
3. Serviços para os domínios existentes, com mudanças incrementais.
4. Estados e transições explícitos, concorrência/versão e prevenção de duplicidade.
5. Arquivos públicos e privados com regras de referência/publicação.
6. Processos assíncronos de notificação com histórico de entrega e repetição, se aprovados.
7. Testes de cálculo, permissões, snapshots, estoque agregado, dados históricos e integração simulada.
8. Estratégia de homologação Node/Docker na VPS e publicação versionada, separada dos outros sistemas.

## Critério de conclusão do protótipo

O protótipo precisa demonstrar o fluxo de um visitante que pede orçamento; de um Comercial que prepara e compartilha uma proposta; de um Admin que acompanha e configura; de um DHO que trata candidatura; e de um Admin que publica conteúdo/campanha. Cada ação deve indicar se é visual, se já usa o motor existente ou se depende de implementação nova.
