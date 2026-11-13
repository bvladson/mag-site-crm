# Encaixe do novo interno — Comercial, solicitações e propostas

Análise de código em 16/10/2026. Origem visual: `C:/Users/VLADSON/Downloads/Site - interno`. Sistema real: `C:/Users/VLADSON/Downloads/SITE MAGMOVEIS INSTITUCIONAL`. Leitura apenas; sem alterações na aplicação, dados, VPS ou configurações. Nenhum dado pessoal real ou segredo foi consultado.

## Conclusão

É possível incorporar o visual ao interno atual. Ambos usam React 19 e as mesmas versões declaradas de TanStack Start/Router. O projeto novo deve fornecer componentes, composição de telas e navegação; autenticação, servidor, SQLite, integrações e regras comerciais devem continuar no projeto atual. Não é uma aplicação funcional pronta para substituir o sistema: as telas comerciais só leem arrays fictícios de `src/lib/mock.ts`, e suas ações não chamam as funções reais.

## Mapa de telas e ligações

| Tela real atual | Referência visual nova | Ligação real necessária |
| --- | --- | --- |
| `/interno` | `/` — visão geral | `getDashboard` em `src/lib/admin.functions.ts`; indicadores de propostas/negociações exigem novas consultas agregadas respeitando o proprietário. |
| `/interno/orcamentos` | `/leads` — solicitações do site | `listQuotes`, `getQuote`, `updateQuote` em `admin.functions.ts`; conservar detalhe da solicitação e notas. |
| `/interno/orcamentos/$id` | Não há detalhe de lead no novo | Preservar tela/dados atuais e aplicar a nova apresentação. `criarOrcamentoInterno({pedidoSiteId})` cria a negociação. |
| `/interno/orcamentos-internos` | `/negociacoes` | `listarOrcamentosInternos`, `criarOrcamentoInterno`, `duplicarOrcamentoInterno` em `orcamentos.functions.ts`. |
| `/interno/orcamentos-internos/$id` | `/negociacoes/$id` — oito passos | `lerOrcamentoInterno`, `salvarOrcamentoInterno`, `opcoesDoOrcamento`, `mudarEstadoOrcamento`; funções de proposta e revisão Omie existentes. |
| `/orcamento` — formulário público real | `/solicitar` — simulação no painel | Manter o formulário público real e seus produtos, validação e proteção antirrobô; substituir a simulação por acesso/prévia explícita, sem confundir com envio real. |
| `/interno/proposta`, `/interno/omie`, usuários e conta | `/admin` — cartões de módulos | Conservar páginas funcionais e seus formulários; os cartões novos não possuem ações. |

As URLs acima identificam a equivalência de conteúdo. Recomenda-se manter `/interno/...` no sistema publicado e adaptar os links novos, preservando favoritos e separação do site público.

## O que o protótipo realmente faz

- `src/routes/negociacoes.tsx`: lista exemplos, filtra Comercial pelo nome literal `Carlos Consultor`. “Nova negociação” não possui `onClick`.
- `src/routes/negociacoes.$id.tsx`: muda o passo apenas em `useState`; usa sempre os mesmos itens, frete fixo e versões v2/v1. PDF, comparação, WhatsApp, e-mail, marcar enviada e aceite são botões sem ação. A revisão Omie mostra resultados fictícios “ok/disponível”.
- `src/routes/leads.tsx`: origem, unidade, status e quantidade de negociações vêm dos exemplos. “Converter” e “Nova negociação…” não executam criação nem confirmação de duplicação.
- `src/routes/solicitar.tsx`: `preventDefault()` + `setOk(true)`, com aviso de simulação; não coleta nem grava os dados.
- `src/routes/index.tsx`: indicadores e próximas ações são contagens dos arrays fictícios; o filtro de proprietário também usa nome literal.
- `src/components/Shell.tsx`: seletor de unidade e busca não filtram dados; seletor “Ver como” troca um estado local, não é autenticação.
- `src/test/app-routing.test.tsx`: verifica apenas correspondência de rota `/`. Não valida cálculos, autorização, persistência ou fluxo comercial.

## Regras que a integração precisa preservar

1. **Sessão, papéis e proprietário reais.** `orcamentos.functions.ts` autoriza Admin/Comercial e `orcamentos.server.ts` restringe cada negociação por `owner_id`. A pessoa pode acumular papéis; o novo `Perfil` único não representa isso. Remover a simulação “Ver como” da aplicação operacional. O servidor deve continuar rejeitando acesso cruzado mesmo com URL digitada diretamente.
2. **ID interno distinto do número comercial.** As funções reais recebem UUID. O protótipo usa `MAG-Q-2026-00042` como `id`; esse valor deve continuar como número exibido, não substituir o UUID. Em `negociacoes.$id.tsx`, ID inexistente cai em `negociacoes[1]`: deve virar “não encontrado”, nunca mostrar outra negociação por padrão. O detalhe novo também não confere proprietário.
3. **Passo visual distinto de estado comercial.** Os oito passos são uma organização útil, mas clicar “Aceite” não pode aceitar um orçamento. Estados reais: `rascunho`, `salvo`, `enviado`, `aceito`, `enviado_omie`, `erro_omie`, `cancelado`. Transições dependem de validações, versão e ações explícitas no servidor. Depois do aceite os dados ficam bloqueados.
4. **Cálculos oficiais em centavos.** Reutilizar `calcularItem` de `orcamento-regras.ts` e `totaisDaProposta` de `proposta-regras.ts`, com recálculo pelo servidor ao salvar. A fórmula simplificada nova arredonda o total já descontado; a real arredonda bruto e desconto separadamente, podendo diferir em centavos. Preservar desconto em reais por linha inteira, desconto percentual, quantidades decimais, desconto geral, frete e montagem. O resumo não pode usar frete fixo de R$ 150 nem mostrar total fictício.
5. **Concorrência e propostas imutáveis.** Salvar usa versão do orçamento. Gerar proposta usa versão do orçamento, cria snapshot e PDF próprio. Botões devem receber a versão vigente real. Reusar `gerarPropostaComercial`, `compararVersoesDaProposta`, `gerenciarVersoesDaProposta` e a rota protegida de PDF. Preservar regras de arquivar/excluir e versões já enviadas/aceitas.
6. **Envio e aceite separados.** `registrarAcaoDaProposta` registra abertura do compartilhamento; `marcarPropostaEnviada` marca explicitamente o envio. Aceite deve seguir `mudarEstadoOrcamento` e as checagens do snapshot vigente. Abrir WhatsApp não prova envio nem aceite. Envio direto por e-mail continua dependente de configuração.
7. **Pedido Omie proveniente da proposta aceita.** Preservar revisão, hash da proposta, conferência de totais, vendedor do proprietário, cliente confirmado, token de revisão, política de estoque, código de integração/idempotência e estados de envio incerto. Não habilitar escrita Omie como consequência da troca visual. Frete, desconto geral e montagem continuam sujeitos aos bloqueios atuais; o novo carrossel de passos não resolve regras fiscais/contábeis.
8. **Dados visíveis na proposta.** PDF não deve expor saldo numérico de estoque, custo, margem, locais internos ou notas privadas. Respeitar contatos do perfil do consultor que foram autorizados para exibição; o consultor é o dono da negociação, não necessariamente quem apertou o botão.

## Melhorias que exigem motor, além do visual

- **Unidade única compartilhada:** a coluna de unidade do protótipo é fictícia. Não há vínculo de unidade no modelo comercial lido (`quote_requests`, `internal_quotes` e funções atuais). Para filtro verdadeiro, criar cadastro único e relações explícitas, migrando registros anteriores como “não informado”; não inferir unidade pelo dono ou endereço de entrega. Vínculos da árvore não devem se tornar automaticamente permissão comercial.
- **Vínculo e conversões de lead:** `internal_quotes.source_request_id` já existe, portanto contar/listar negociações vinculadas é viável com uma consulta real. A listagem atual ainda não retorna a contagem nem responsável próprio da solicitação. “Arquivado” aparece no mock, mas não está nos estados atuais de solicitação (`novo`, `em atendimento`, `orçamento enviado`, `ganho`, `perdido`). Definir a regra antes de migrar. Aviso de duplicação na interface precisa ser acompanhado da checagem adequada no servidor para concorrência.
- **Estoque repetido:** a proposta atual já agrega quantidade por produto para o selo (`propostas.server.ts`, por volta da linha 133). A revisão de pedido (`omie-conversao.server.ts`, por volta das linhas 309–319) consulta IDs únicos, mas compara cada linha isoladamente com o disponível. Duas linhas do mesmo produto com 4 e 2 unidades e saldo 5 passam individualmente; a soma 6 excede o saldo. O protótipo demonstra uma agregação por SKU, porém não consulta estoque e marca tudo disponível. Implementação real deve agregar por `produtoId` e testar saldo indisponível, repetição, quantidade fracionária e política bloquear/permitir antes de habilitar pedidos.
- **Indicadores e busca:** fornecer consultas autorizadas para indicadores de propostas/aceites/revisão e busca real. Não carregar todas as negociações no navegador para depois filtrar por nome.

## Ordem recomendada de incorporação

1. Aplicar navegação, cores, tipografia e componentes do novo painel dentro do layout autenticado existente.
2. Migrar listas e detalhe comercial para os dados reais, preservando todos os campos e ações atuais, inclusive os que não foram desenhados no protótipo.
3. Organizar o editor em passos com rascunho, bloqueios, retorno de erro e proteção contra perder alterações; distinguir navegação de mudança de estado.
4. Acrescentar unidade compartilhada, vínculo de negociações no lead e indicadores como evolução separada do banco/motor.
5. Validar isolamento Admin/Comercial/DHO e acesso cruzado; cálculo em centavos e descontos; conflitos de versão; PDF antigo idêntico; envio/aceite separados; revisão Omie simulada sem escrita; leitura e edição em celular. Só então planejar publicação da versão.

Fontes principais do sistema atual: `src/lib/admin.functions.ts`, `src/lib/orcamentos.functions.ts`, `src/lib/orcamentos.server.ts`, `src/lib/orcamento-regras.ts`, `src/lib/propostas.functions.ts`, `src/lib/propostas.server.ts`, `src/lib/proposta-regras.ts`, `src/lib/omie-conversao.server.ts`, `src/routes/_authenticated/interno.orcamentos.$id.tsx`, `src/routes/_authenticated/interno.orcamentos-internos.index.tsx`, `src/routes/_authenticated/interno.orcamentos-internos.$id.tsx`.
