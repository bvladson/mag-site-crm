# Integração Comercial — implementação local

Data: 16/10/2026. Implementação no institucional existente; nenhum deploy ou alteração na VPS foi feito por este módulo.

## Telas e operações reais

- `/interno/orcamentos`: solicitações reais do banco, busca, estados, unidade, responsável e quantidade de negociações vinculadas.
- `/interno/atribuicao`: administrador configura consultores elegíveis e unidade; atribui pedidos ainda não convertidos. Comercial consulta sem poder modificar. Conflitos entre abas são rejeitados por revisão.
- Distribuição manual, por unidade e rodízio geral persistem no banco. A regra é aplicada a novas solicitações do formulário público de orçamento. Rodízio por unidade possui cursor independente. Sem consultor elegível ou sem preferência no modo por unidade, o pedido fica pendente para atribuição manual. O padrão inicial é manual; pedidos anteriores não são redistribuídos automaticamente.
- O formulário público `/orcamento` oferece preferência de unidade com as unidades ativas reais. A captura de UTM existente é preservada. Falha da atribuição não desfaz um pedido já registrado; gera evento técnico de auditoria para revisão.
- Conversão cria a negociação no nome do consultor atribuído, inclusive quando executada pelo administrador. Outro Comercial é barrado. Repetição retorna a negociação já vinculada, impedindo duplicação por duplo clique. A duplicação explícita da negociação continua como fluxo separado, com novo número.
- `/interno/orcamentos-internos`: apresentação “Negociações e propostas”, com proprietário, versão real e estado.
- Detalhe mantém todos os formulários, ações e validações existentes. Acrescenta oito atalhos navegáveis para seções, sem confundir navegação com envio, aceite ou criação do pedido. Alterações não salvas são protegidas ao sair. Mudança apenas no valor do desconto passa a ser reconhecida como alteração.
- `/interno/orcamentos-internos/$id/pdf?v=N`: prévia com o PDF real protegido, número e total da versão gravada; baixar, abrir e impressão da vigente. Versão inexistente é rejeitada. A prévia não monta um segundo documento HTML com valores calculados separadamente.

## Motor e segurança

Módulos novos: `src/lib/assignments.server.ts`, `src/lib/assignments.functions.ts`, `src/components/interno/LeadAssignments.tsx`. As tabelas são inicializadas de forma idempotente no próprio módulo: configuração, consultores elegíveis, cursores, atribuições e histórico. O banco principal não foi substituído.

As gravações administrativas revalidam papel e conta ativa no banco. Consultores inativos não participam da distribuição. Atribuição manual aceita somente usuários Admin/Comercial ativos e unidades válidas. Leads já convertidos não trocam de dono por esse módulo; o responsável da negociação permanece preservado. Regras e atribuições são auditadas sem copiar dados pessoais para logs técnicos.

Na revisão Omie, a conferência de saldo agora soma linhas do mesmo produto por `produtoId`, mantendo as linhas originais do pedido. A soma usa milésimos inteiros para quantidades decimais. O mesmo cuidado foi aplicado ao cálculo do selo de disponibilidade de novas propostas. Isso impede tanto subestimar o pedido repetido quanto apontar falta falsa por `1,1 + 2,2` em ponto flutuante.

Regras oficiais de dinheiro continuam em centavos e usam as funções existentes. Um caso de 101 centavos com desconto de 50% é testado explicitamente: o desconto arredondado é 51 e o total é 50. Layout e renderização de PDFs existentes foram preservados; nenhuma escrita no Omie ou envio de mensagem foi habilitado.

## Validação concluída

Comando: `node --test tests/assignments.test.mjs tests/orcamento-regras.test.mjs tests/omie-conversao.test.mjs tests/proposta.test.mjs` — **63 testes aprovados**. A suíte cobre papéis, revogação de acesso, proprietário, revisão concorrente, atribuição real, rodízio, idempotência, centavos, estoque repetido e fracionário, versões, aceite, conteúdo privado e reconstituição de PDF antigo.

Homologação isolada foi criada fora do repositório em `C:/Users/VLADSON/Downloads/MAG INTERNO INTEGRACAO - 2026-10-16`, com usuários e dados fictícios, catálogo local, índices, duas negociações de proprietários diferentes, uma proposta de 30 itens extensos e currículos de teste. Credenciais ficaram apenas em arquivo privado local, sem impressão nos logs.

A verificação de PDFs com PyMuPDF aprovou duas versões de uma página e uma proposta de cinco páginas. Totais e SKUs conferem com os snapshots, hashes conferem, formato A4 confirmado, nenhum texto ultrapassa a página e notas internas não aparecem. As páginas iniciais e o fechamento foram inspecionados visualmente sem sobreposição.

## Limites explícitos

- Distribuição automática atende solicitações de orçamento; contatos institucionais continuam no módulo de contatos existente.
- Não há alerta automático após 24 horas. O texto demonstrativo do protótipo não foi apresentado como função ativa.
- As oito etapas organizam a navegação pelas seções do editor. Não introduzem novos estados de negócio nem dispensam confirmação de envio ou aceite.
- Cadastro único de unidades, autenticação/MFA, shell e demais módulos foram implementados por outras partes da integração e precisam da validação conjunta de build/navegador antes da publicação.
