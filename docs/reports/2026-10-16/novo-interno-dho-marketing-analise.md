# Análise do novo interno: DHO, marketing e administração

Data: 16/10/2026. Análise de código local, sem alteração da aplicação, banco ou VPS.

Fonte proposta: `C:/Users/VLADSON/Downloads/Site - interno`.
Sistema atual: `C:/Users/VLADSON/Downloads/SITE MAGMOVEIS INSTITUCIONAL`.

## Parecer

O visual pode ser adaptado ao sistema atual. A exportação do Lovable é um protótipo: os dados de DHO vêm de `src/lib/mock.ts`; os módulos de conteúdo e administração apresentam listas e cartões fixos. Ela não substitui os serviços de banco, publicação, arquivos privados e permissões existentes.

A integração recomendada usa a nova organização visual dentro das rotas autenticadas `/interno`, mantendo os serviços atuais. O protótipo oferece um desenho para evoluir as telas, mas vários elementos ainda precisam ganhar comportamento real.

## DHO

### O que a nova tela entrega

`src/routes/dho.tsx` possui uma tabela com duas vagas fictícias e um funil com as seis etapas já usadas pelo sistema atual: novo, em análise, contato realizado, entrevista, banco de talentos e encerrado. Clicar no cartão de uma candidatura seleciona sua ficha por estado React. A tabela, o funil e a ficha são boas referências visuais.

O botão **Nova vaga** não possui ação. Não há formulário de vaga, edição da candidatura, alteração de status, abertura de PDF, busca ou consulta ao servidor. A ficha só mostra consentimento fictício e textos de funcionalidades futuras. Não há movimentação de cartões entre etapas.

### O que já existe no sistema atual e precisa continuar

- Lista e editor completos de vagas em `interno.vagas.index.tsx` e `interno.vagas.$id.tsx`, usando `listJobsAdmin`, `getJobAdmin` e `saveJobAdmin` em `src/lib/hr.functions.ts`.
- Vagas com título, slug, área, local, modelo, contrato, horário, resumo, descrição, responsabilidades, requisitos, diferenciais, status, abertura, encerramento, prazo e prioridade.
- Regras de publicação e URL de vaga, contagem de inscrições, prazo em Fortaleza e página pública de carreiras.
- Lista de candidaturas separada entre vagas e banco de talentos, filtros por vaga/área, nome, cidade, datas e status, em `interno.candidaturas.index.tsx`.
- Ficha com dados de contato, vaga, mensagem, protocolo, datas, notas internas, finalidade, consentimento e previsão de retenção, em `interno.candidaturas.$id.tsx`.
- Leitura e atualização protegidas no servidor em `src/lib/admin.functions.ts`, somente para Admin ou DHO.
- PDF privado por `/api/interno/curriculo/:id`, validando sessão e papel a cada download, retornando anexo com `private, no-store` e gravando auditoria. O caminho físico do PDF não é devolvido ao navegador.
- Política de retenção calculada por `src/lib/retention.ts`; não existe descarte automático. Valores dependem da política configurada pela MAG.

O funil visual pode consumir o retorno da lista real e abrir a ficha atual. Se passar a permitir mudança de etapa, precisa chamar `updateApplication`, validar permissão, tratar erro e atualizar a consulta. O consentimento não pode ser alterado pelo movimento de um cartão. Banco de talentos inclui inscrições diretas, inscrições com opção de permanência e candidaturas movidas internamente para essa etapa; a finalidade continua derivada do registro original.

### O que exige desenvolvimento adicional

Agenda de entrevistas, avaliações e responsável aparecem apenas como descrições. Não foram encontrados cadastros próprios para esses recursos no modelo atual. Seriam necessários modelo persistente, serviços, autorização, histórico e interface. Retenção já possui cálculo e exibição no sistema atual; uma fila de revisão e descarte seria uma ampliação, não a criação do cálculo do zero.

## Árvore de links, conteúdo e campanhas

### O que a nova tela entrega

`src/routes/conteudo.tsx` contém quatro rótulos fixos, um desenho de prévia e um banner de exemplo. O único comportamento implementado é alternar a largura da prévia entre celular e computador.

- **Publicar** e **Ver versões** não possuem handlers.
- O símbolo de arrastar e `cursor-grab` não implementam reordenação.
- Não há edição de texto, destino, imagem, vendedor, unidade ou calendário.
- “Até 3 banners com vigência”, “Destino validado e unidade” e “Cliques agregados” são cartões informativos. Não há cadastro, programação, carrossel nem medição de cliques.

### O que já existe no sistema atual e precisa continuar

`src/components/interno/LinkTreeEditor.tsx` é um editor funcional, ligado a `links-admin.functions.ts`, `links.server.ts` e ao esquema `links.ts`.

- Conteúdo com título, subtítulo, logo, capa e tema.
- Blocos de link, WhatsApp, vendedor, endereço e seção.
- Vendedores com foto, mensagem, WhatsApp e associação à unidade.
- Unidades com endereço, mapas Google/Waze, cor, horário, WhatsApp e telefone fixo.
- Fundos fixos, imagem própria ou calendário de doze temas mensais, com prévia do mês.
- Validação de URLs e campos, otimização e recorte de imagens, ordenação, duplicação, ocultação e remoção de blocos.
- Rascunho independente da publicação, confirmação para publicar, histórico imutável, restauração para rascunho e controle de revisão para conflitos entre editores.
- Proteção contra saída com alterações pendentes e preservação das alterações locais em conflito.
- Upload exclusivo de administrador; fotos de rascunho e versões retiradas não são servidas pela rota pública. A prévia usa rota privada.
- Publicação em `/links/` e QR permanente em `/links/qr.svg`.

A melhor integração aproveita a moldura de duas colunas do protótipo e mantém o editor funcional. Substituí-lo pelo conteúdo de `conteudo.tsx` eliminaria os recursos listados acima.

### Campanhas futuras

O modelo atual de árvore possui blocos e fundos, mas não possui entidade de campanha, início/fim, métricas ou banner responsivo com destinos distintos. Para essas funções será preciso desenvolver contratos de dados e serviços próprios. Uma imagem da prévia não significa que um carrossel esteja pronto.

Também existe um módulo atual de **Redes sociais** (`interno.redes.tsx` e `social-admin.functions.ts`) ausente do protótipo: modo API/manual/desligado, perfil oficial, estado de sincronização, conferência de identidade da conta e destaques manuais com imagem, tipo, data, ordem, ocultação e exclusão. Essa tela deve continuar acessível na nova navegação de Site e marketing.

## Usuários, unidades e administração

`src/routes/admin.tsx` apresenta seis cartões sem links, formulários ou operações: usuários, emitente, Omie, cadastro único de unidades, convites/MFA e auditoria. Funciona como índice visual de configuração, ainda sem execução.

No sistema atual, `interno.usuarios.tsx` permite criar contas, somar perfis Admin/Comercial/DHO, alterar permissões, redefinir senha e desativar contas por serviços protegidos. A própria pessoa altera a senha em Minha conta. Uma pessoa pode ter mais de um papel; o protótipo usa um único `perfil` e precisa ser adaptado.

O cadastro único de unidades é uma evolução coerente, mas atualmente as unidades da árvore estão dentro do conteúdo versionado da própria árvore. Há dados institucionais também em `src/config/site.ts`, e as vagas usam local em texto livre. Tornar o seletor global efetivo exige cadastro comum com identificadores, vinculação e migração cuidadosa; apenas desenhar um seletor não vincula registros antigos a Centro/BR-116.

A auditoria técnica já existe no banco (`audit_log`) e registra várias operações. O cartão “Auditoria / linha do tempo” marcado como novo deve ser entendido como nova interface de consulta e possível ampliação do histórico, preservando os eventos existentes. Convites e MFA aparecem como propostas; não há fluxo funcional na nova exportação.

## Permissões e navegação

`src/components/Shell.tsx` começa com `useState<Perfil>("admin")` e permite trocar livremente o papel num seletor de demonstração. Os componentes ocultam telas consultando esse estado. Isso é simulação visual, sem autenticação real; a frase em `SemAcesso` sobre verificação no servidor é somente texto.

A integração deve usar a sessão real do sistema atual, os papéis cumulativos e a autorização de cada serviço. O seletor “Ver como” deve ser removido da interface operacional ou ficar estritamente limitado a demonstração sem conceder permissões.

A busca global e o seletor de unidade do cabeçalho não possuem comportamento. No celular, a barra lateral é escondida (`hidden ... md:flex`) e não existe menu alternativo nessa exportação; será necessário oferecer navegação móvel. As novas rotas de raiz `/dho`, `/conteudo` e `/admin` precisam ser encaixadas sob `/interno`, preservando os endereços públicos institucionais e os caminhos atuais compartilhados.

## Ordem sugerida

1. Adaptar componentes visuais e navegação ao layout autenticado existente, com menu móvel, conta real e permissões cumulativas.
2. Integrar o funil DHO à lista e ficha reais; preservar o editor de vagas, filtros e download privado.
3. Reorganizar a área Site e marketing mantendo o editor completo da árvore e o módulo de redes sociais.
4. Criar unidades compartilhadas com migração explícita dos vínculos, antes de tornar o filtro global obrigatório.
5. Desenvolver banners/campanhas, agenda DHO, avaliações, consulta de auditoria e MFA como entregas funcionais separadas, com validação apropriada.

## Evidências principais

Novo protótipo: `src/lib/mock.ts`; `src/components/Shell.tsx:23`; `src/routes/dho.tsx:21`; `src/routes/conteudo.tsx:19`; `src/routes/admin.tsx:18`; `src/routes/__root.tsx`.

Sistema atual: `src/lib/hr.functions.ts`; `src/lib/admin.functions.ts:137`; `src/lib/retention.ts`; `src/routes/api.interno.curriculo.$id.ts`; `src/lib/links.ts:61`; `src/lib/links.server.ts:84`; `src/components/interno/LinkTreeEditor.tsx`; `src/routes/_authenticated/interno.usuarios.tsx`; `src/lib/social-admin.functions.ts`; `src/routes/_authenticated/route.tsx`.
