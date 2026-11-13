# Notas factuais — Comercial, orçamento, proposta e Omie

Data da leitura: 16/10/2026. Escopo: código local do institucional MAG, sem leitura de credenciais e sem chamadas à API Omie. Esta nota descreve o que está implementado no código; flags operacionais e uso real devem ser confrontados com a VPS. Nenhum dado real de cliente foi copiado.

## 1. Existem dois fluxos distintos

### 1.1 Solicitação pública de cotação

O visitante navega pelo catálogo, adiciona produtos à lista e define quantidades. A lista fica no navegador em localStorage, com até 100 produtos e quantidade de 1 a 999 por produto na interface.

Em /orcamento, informa nome, empresa/CNPJ opcionais, WhatsApp, e-mail, cidade/UF e mensagem. O servidor valida os campos, aplica limite de requisições e honeypot, passa pela verificação Turnstile quando configurada, resolve os produtos pelo catálogo oficial e grava a solicitação com seus itens. Nome e SKU do produto vêm do servidor.

O visitante recebe protocolo e pode abrir o WhatsApp com o resumo. Trata-se de uma solicitação de atendimento: não há compra, cobrança, reserva de estoque ou Pedido de Venda criado automaticamente no Omie. O site público não publica preços: o schema exige price = null.

A solicitação entra na área /interno/orcamentos, acessível a Admin e Comercial. Sua situação é um campo operacional com as opções novo, em atendimento, orçamento enviado, ganho e perdido. A equipe pode pesquisar, consultar itens/contatos/UTMs e alterar situação e notas internas.

As notificações por e-mail são tentadas após a gravação. Uma falha de notificação não desfaz a solicitação.

Fontes: src/lib/quote.tsx; src/routes/orcamento.tsx; src/lib/leads.functions.ts; src/lib/admin.functions.ts; src/routes/_authenticated/interno.orcamentos.index.tsx; src/routes/_authenticated/interno.orcamentos.$id.tsx; src/lib/omie.server.ts.

### 1.2 Orçamento comercial interno

Em /interno/orcamentos-internos, Admin e Comercial criam orçamento vazio ou a partir de uma solicitação do site. Na conversão, o sistema copia cliente e itens encontrados no cadastro atual; preços começam para preenchimento pelo Comercial. Produtos que desapareceram do catálogo são registrados em nota, em vez de inventar uma correspondência.

Cada orçamento recebe número sequencial MAG-Q-AAAA-NNNNN e proprietário, com histórico próprio. O mesmo número será o código de integração do pedido no Omie.

O Comercial acessa apenas os próprios orçamentos internos; o Admin acessa todos. O orçamento criado a partir do lead pertence ao usuário que fez a criação. DHO não acessa as funções comerciais.

Há duplicação de orçamento para uma negociação separada: novo número, mesmo proprietário, cliente/itens/condições copiados, sem copiar propostas, aceite ou Pedido Omie anterior.

Fontes: src/lib/orcamentos.functions.ts; src/lib/orcamentos.server.ts; src/routes/_authenticated/interno.orcamentos-internos.index.tsx.

## 2. Dados e cálculos do orçamento interno

O editor oferece:

- Cliente: razão/nome, fantasia, CPF/CNPJ, contato, e-mail, telefone, cidade e UF.
- Itens: produto Omie, SKU/nome/unidade, quantidade, preço digitado, desconto percentual ou em reais.
- Condições: pagamento do cadastro Omie, previsão, consumidor final, e-mail para NF, conta corrente da venda e observações do pedido.
- Dados da proposta: contato A/C, validade, desconto geral, frete, montagem e observações comerciais.
- Notas internas, separadas do conteúdo enviado ao cliente.

O servidor relê os metadados do produto no índice interno e recalcula todos os valores. Dinheiro é tratado em centavos inteiros. Quantidade aceita até três casas decimais e desconto percentual até duas. Um desconto em reais aplica-se ao total da linha, não a cada unidade.

Cálculo por linha: bruto = quantidade × preço; total da linha = bruto − desconto da linha. Cálculo da proposta: soma das linhas − desconto geral + frete + montagem. O desconto geral não pode superar o subtotal.

A conta corrente não é preenchida automaticamente. Bradesco e Stone aparecem primeiro; existe apenas uma sugestão Bradesco quando o cliente tem CNPJ ou a condição indica depósito. A pessoa precisa selecionar a conta de cada venda.

O formulário usa versão do registro para evitar sobrescrever silenciosamente uma edição feita em outra aba ou por outra pessoa. Há no máximo 199 itens.

Fontes: src/lib/orcamento-regras.ts; src/lib/proposta-regras.ts; src/lib/orcamentos.server.ts; src/routes/_authenticated/interno.orcamentos-internos.$id.tsx.

## 3. Estados e aceite

Estados implementados: rascunho, salvo, enviado, aceito, enviado_omie, erro_omie e cancelado.

Fluxo principal: rascunho → salvo → enviado ao cliente → aceito → Pedido no Omie. Um erro de integração leva a erro_omie e permite uma nova tentativa controlada.

Itens, preços e condições são editáveis em rascunho, salvo e enviado. Após o aceite, ficam travados. Antes de um Pedido Omie criado ou incerto, Criar nova revisão desfaz o aceite ativo, volta a salvo e mantém a versão anteriormente aceita no histórico. É preciso gerar outra versão, marcar envio e registrar um novo aceite.

O aceite é registrado pela equipe interna, por confirmação no painel. Não há neste fluxo um portal público de aceite, assinatura eletrônica, confirmação autônoma do cliente ou prova de leitura.

Para aceitar, o orçamento precisa ter cliente, itens com preço, condição de pagamento, previsão, conta da venda ativa e proposta vigente. A proposta vigente deve ter sido marcada como enviada e deve corresponder ao conteúdo atual. Uma versão recusada, uma versão já aceita antes de uma revisão ou uma versão antiga sem os dados necessários ao Pedido não pode ser reutilizada para novo aceite.

A previsão comercial aceita fica congelada. Antes do pedido, uma mudança exige nova revisão/proposta/aceite. Depois do pedido, a previsão operacional deve ser ajustada no Omie.

Fontes: src/lib/orcamento-regras.ts; src/lib/orcamentos.server.ts; src/lib/proposta-conteudo.server.ts.

## 4. Proposta comercial em PDF e versões

Gerar proposta cria uma versão numerada v1, v2 etc., com snapshot dos dados do orçamento, emitente, cliente, perfil do consultor, itens, totais, validade e dados operacionais do pedido. Há uma versão vigente por orçamento.

A proposta é renderizada em PDF A4 timbrado no servidor. Traz produtos/fotos, valores, descontos, condições e contatos autorizados do consultor. Não traz custo, margem, quantidade de estoque, nomes de locais de estoque ou notas internas. A pronta entrega depende do catálogo estar fresco e de o disponível cobrir a quantidade pedida; produtos repetidos são somados para esse selo.

O consultor impresso é sempre o dono do orçamento, mesmo quando o Admin gera o documento. Em Minha conta, cada usuário comercial define nome, cargo, telefone, WhatsApp, e-mail, assinatura textual e quais contatos deseja exibir.

O Admin pode configurar os dados institucionais e a validade padrão da proposta em /interno/proposta. Mudanças valem para novas versões; os dados textuais dos snapshots antigos são preservados.

O histórico permite visualizar e baixar versões, comparar mudanças e arquivar/desarquivar versões antigas permitidas. Excluir é uma marcação lógica, permitida apenas para versão anterior que nunca foi enviada, recusada ou aceita. A vigente e as aceitas são protegidas. Números de versão não são reutilizados.

O PDF é uma rota privada que exige sessão e permissão. Não existe link público do documento para o cliente; a equipe baixa e anexa o arquivo.

Abrir WhatsApp, programa de e-mail ou o compartilhamento do aparelho registra apenas o início do compartilhamento. Não equivale a envio. A equipe marca enviada explicitamente; um provedor configurado pode confirmar despacho pelo servidor.

Há envio direto de e-mail com PDF, mas depende de PROPOSTA_EMAIL_ENVIO=ligado, chave do provedor e remetente configurado. Sem isso, a tela orienta abrir o programa de e-mail e anexar o PDF manualmente. O WhatsApp abre com mensagem pronta; o PDF não é anexado automaticamente.

Fontes: src/lib/propostas.server.ts; src/lib/propostas.functions.ts; src/lib/proposta-pdf.server.ts; src/lib/proposta-regras.ts; src/routes/api.interno.orcamentos-internos.$id.proposta.$versao.ts.

## 5. Integração com Omie

### 5.1 Três caminhos separados

1. Catálogo público: arquivos publicados pelo sincronizador. Visitas não chamam a API. Só publica mobiliário/peças elegíveis, imagens locais e selos de disponibilidade. Preços e números exatos do estoque não vão ao visitante.
2. Consulta rápida interna: busca em índices locais e consulta de estoque sob demanda via omie-consulta. Tem cache, limites e pausa durante sincronização. Admin e Comercial podem consultar estoque detalhado internamente.
3. Conversão em Pedido de Venda: serviço isolado omie-pedidos, chamado apenas pelo servidor do site com token. É o componente autorizado no código a escrever clientes e pedidos na API, somente quando OMIE_ORDER_WRITE_ENABLED está true. Com escrita desligada, retorna simulação e não cria pedido.

O índice interno permite também localizar cadastros completos do Omie, além dos produtos publicados no catálogo. Os preços da negociação são digitados pela equipe; não há neste fluxo uma precificação automática baseada em custo/margem ou tabela pública.

Fontes: src/lib/omie.ts; src/lib/omie.server.ts; src/lib/produtos-internos.server.ts; scripts/sync-omie.mjs; scripts/omie-indice.mjs; scripts/omie-consulta.mjs; scripts/omie-pedidos.mjs.

### 5.2 Referências e vínculo do vendedor

A sincronização armazena vendedores, etapas, condições de pagamento, categorias e contas correntes em cache próprio. Falha de sincronização mantém o último cache válido e registra o motivo.

O Admin escolhe etapa, categoria e políticas permitidas e confirma o vínculo usuário do painel → vendedor do Omie. Sugestões de nome/e-mail não criam vínculo automático. A autoria da venda no Omie usa o vendedor ligado ao dono do orçamento, mesmo se o Admin executar a operação.

O Admin define a política para estoque insuficiente: confirmar, permitir ou bloquear. Contas não expõem agência, número bancário ou saldo ao painel dessa integração.

Fontes: src/lib/omie-referencias.server.ts; scripts/omie-referencias.mjs; src/routes/_authenticated/interno.omie.tsx.

### 5.3 Cliente e revisão obrigatória

O sistema pode buscar clientes por documento ou nome, vincular explicitamente um cliente existente e, quando permitido, criar um cliente novo com dados confirmados. CPF/CNPJ precisa ser válido e não pode divergir do documento da proposta aceita. Um cadastro novo exige documento/e-mail e conferência de duplicidade.

Antes do pedido, o sistema revalida o vendedor, cliente, pagamento, etapa, categoria, conta e estoque, compara o payload com a versão aceita e mostra bloqueios/avisos. O Pedido nasce exclusivamente da versão aceita; não aceita preços ou totais oficiais enviados pelo navegador.

A revisão gera token de uso único, válido por 15 minutos, ligado ao usuário/orçamento/hash do pedido. Mudanças posteriores invalidam a revisão. O usuário precisa confirmar a revisão e, conforme a política, confirmar o envio sem estoque suficiente.

Fonte: src/lib/omie-conversao.server.ts.

### 5.4 Criação e prevenção de duplicidade

O número MAG-Q é uma chave de integração estável. O site cria trava transacional por orçamento para evitar duas inclusões simultâneas. Antes de incluir, consulta se o Omie já possui o código. O serviço repete a proteção e confere cliente/itens de pedidos encontrados.

Se houver timeout depois de uma escrita, o estado fica incerto: a próxima revisão deve consultar o Omie antes de tentar qualquer nova inclusão. Não se presume que o pedido falhou só porque a resposta não chegou.

Após uma inclusão confirmada, o serviço lê o pedido de volta para conferir campos e totais. Se a conferência divergir ou não puder ser feita, o resultado é sinalizado; não inclui novamente um pedido que já foi criado.

A etapa permitida é 10, 20, 30 ou 40. O fluxo não usa a etapa de faturamento, não emite NF, não gera cobrança, não solicita e-mail/Pix pelo Omie e não reserva estoque (reservado=N). Consulta posterior de status é uma ação sob demanda e mostra etapa/faturado/cancelado conforme o ERP.

Fontes: src/lib/omie-conversao.server.ts; src/lib/orcamento-regras.ts; scripts/omie-pedidos.mjs.

## 6. Limitações e decisões que o Lovable deve respeitar

1. **Extras da proposta não estão habilitados no Pedido Omie.** Frete, montagem e desconto geral podem constar no PDF, mas impedem a conversão. Frete e desconto geral têm montagem/validação preparadas e desligadas em EXTRAS_NO_PEDIDO. Montagem depende de regra fiscal/contábil ainda não codificada. Não apresentar esses fluxos como integrados.
2. **Duas caixas de atendimento.** A situação do lead público não é sincronizada automaticamente com situação/proposta/aceite/Pedido do orçamento interno.
3. **Fila pública compartilhada.** Todo usuário Comercial tem acesso aos leads públicos; a restrição por dono vale para orçamentos internos. Não há no fluxo lido atribuição de lead, distribuição por unidade, funil Kanban, tarefa de retorno ou SLA.
4. **Conversão repetida do mesmo lead.** Criar orçamento interno pode ser feito novamente: não há unicidade por solicitação de origem. A interface poderia mostrar orçamentos vinculados e pedir escolher entre abrir o existente ou criar uma nova negociação.
5. **Aceite e entrega são manuais.** Não há aceite público/assinatura eletrônica, WhatsApp oficial enviando anexos, confirmação de leitura ou sequência automática de follow-up.
6. **Descontos.** Há validação matemática e limite de 100%, mas não aparece aprovação hierárquica, limite por vendedor, custo/margem ou autorização especial por faixa. Esses critérios precisam de decisão da MAG.
7. **Estoque repetido por produto merece correção.** O editor permite mais de uma linha do mesmo produto. A revisão de conversão compara a quantidade de cada linha com o disponível, sem agregar a soma por produto. Já o selo do PDF agrega. Uma evolução deve unificar essa regra e ter teste de duas linhas cuja soma supera o disponível.
8. **Revisão não reserva estoque.** O saldo é uma fotografia da consulta e pode mudar antes ou depois da inclusão. A política de falta de estoque e a operação no ERP continuam relevantes.
9. **PDF não é um arquivo binário arquivado.** O texto e os dados ficam no snapshot; o PDF é renderizado novamente. Fotos usam caminho por hash e o logo é carregado dos arquivos atuais. O SHA do PDF é conferido pelo core, porém a rota não bloqueia divergência. Para prova documental estrita, considerar guardar o PDF final e seus recursos imutáveis por versão.
10. **Escala.** Tokens de revisão ficam na memória de um único processo. Reiniciar exige nova revisão; múltiplas instâncias exigiriam armazenamento compartilhado ou afinidade. Listagens têm limite de 300, sem paginação encontrada neste fluxo.
11. **Modelagem não é multiempresa/unidade comercial.** Os orçamentos lidos não têm uma unidade Centro/BR-116 ou CNPJ emitente por venda. A configuração do emitente é global. A separação de unidades da árvore de links não vira automaticamente separação fiscal/comercial.

Estas são lacunas funcionais/de arquitetura observadas no código, não incidentes confirmados na operação.

## 7. Requisitos para uma evolução visual sem perder o motor atual

- Separar no menu Solicitações do site, Negociações e Propostas, evitando chamar tudo de orçamento.
- Exibir um fluxo claro com cliente, itens, condições, proposta, envio, aceite, revisão Omie e resultado.
- Reutilizar as regras puras de centavos/totais e as validações server-side.
- Preservar proprietário, consultor, executor e vendedor Omie como papéis diferentes.
- Manter uma versão vigente, snapshots anteriores, aceite vinculado à versão e revisão quando algo muda.
- Mostrar bloqueios de conversão antes da confirmação final, inclusive extras/falta de configuração/estoque.
- Preservar autorização Admin/Comercial no servidor, sigilo do PDF e a separação de DHO.
- Criar APIs/contratos sobre o motor existente se o Lovable produzir outra interface; não substituir o banco ou duplicar o cadastro sem um plano de migração.
- Tratar campanhas, distribuição de leads, métricas, portal de aceite, WhatsApp oficial e aprovações comerciais como novos módulos, com decisão de negócio e escopo próprios.
- Não conectar o navegador diretamente ao Omie nem copiar chaves para frontend, prompt, repositório ou material de redesign.

## 8. Pontos para confirmar na VPS antes do relatório final

- Release em produção corresponde aos arquivos locais analisados?
- OMIE_ORDER_WRITE_ENABLED está ligado ou a conversão está em simulação? Confirmar apenas o booleano, sem revelar variáveis secretas.
- Etapa/categoria/política de estoque foram configuradas e os usuários comerciais possuem vínculos confirmados?
- Quais horários dos sincronizadores de catálogo/índice/referências estão ativos e qual foi o último sucesso?
- Envio direto da proposta por e-mail está habilitado? Notificações de leads também estão entregando?
- Há exemplos reais de uso de extras e demandas de aprovação comercial que exijam definição fiscal?

Testes existentes lidos, não executados nesta análise: tests/proposta.test.mjs, tests/orcamento-regras.test.mjs, tests/omie-conversao.test.mjs e tests/omie-pedidos.test.mjs. Cobrem cálculos, versões, permissões por dono, aceite, extras bloqueados, idempotência, timeout incerto, conferência de payload e leitura de volta.

## 9. Confronto operacional fornecido pela auditoria principal

A auditoria somente de leitura feita na VPS em 16/10/2026, por volta de 11h20 BRT, informou release 20261015-links-v2 e os três serviços saudáveis. A escrita de pedidos Omie estava desligada: o recurso opera em simulação. Nenhum registro existia em omie_orders. Configuração de Resend/remetente estava ausente; portanto, o envio direto de propostas pelo servidor não estava operacional.

Contagens técnicas: quatro solicitações públicas (três novas e uma com orçamento enviado), quatro orçamentos internos (um cancelado, dois enviados e um salvo), oito versões de proposta, dois clientes internos, 33 vendedores sincronizados, dois vínculos usuário/vendedor e 100 referências Omie. Esses números podem conter registros de teste e não devem ser usados como indicadores de desempenho comercial.

A chave legada de conta padrão permanece no cadastro de configurações, mas o código atual não a lê: a conta é escolhida por venda. Não apresentar a existência dessa chave como funcionamento de uma conta padrão.
