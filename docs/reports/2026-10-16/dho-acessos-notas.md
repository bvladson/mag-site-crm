# DHO, recrutamento, acessos e auditoria — estado do código em 16/10/2026

Inspeção somente de leitura do projeto local. Não foram consultados dados pessoais, arquivos `.env`, credenciais ou banco real. A ativação dos provedores e dos prazos em produção depende da conferência do relatório principal. Esta nota documenta implementação existente; propostas estão identificadas separadamente.

## 1. O que é o DHO hoje

O módulo implementa **recrutamento**: publicação de vagas, recepção de candidaturas, banco de talentos, consulta de currículos e acompanhamento manual do candidato. Não há módulo identificado de folha, ponto, férias, benefícios, admissão documental, treinamento, avaliação de desempenho ou gestão completa de colaboradores.

### Rotas e responsabilidades

| Área | Rota | Funcionamento existente |
|---|---|---|
| Carreiras pública | `/carreiras` | Cultura e áreas de interesse definidas no código; lista somente vagas publicadas dentro do prazo. Sem vagas, informa a ausência e oferece o banco de talentos. |
| Vaga pública | `/carreiras/vagas/:slug` | Descrição completa e formulário enquanto aberta; vaga encerrada preserva URL, mostra aviso, remove formulário e recebe `noindex`. |
| Banco público | `/carreiras/banco-de-talentos` | Cadastro espontâneo com PDF e consentimento específico para banco de talentos. |
| Vagas no painel | `/interno/vagas`, `/interno/vagas/nova`, `/interno/vagas/:id` | Admin ou DHO cria e altera conteúdo, status, datas e prioridade; lista mostra número de candidaturas e link para filtrá-las. |
| Candidaturas no painel | `/interno/candidaturas`, `/interno/candidaturas/:id` | Admin ou DHO filtra, examina contato/consentimento/PDF, altera status e notas internas. |
| Download privado | `/api/interno/curriculo/:id` | Verifica sessão e papel novamente em cada acesso; Comercial não acessa. |

As seis áreas institucionais são Comercial, Operações / Montagem, Logística, Marketing, Administrativo / Financeiro e Atendimento. São constantes em `src/config/careers.ts`; o cadastro espontâneo também aceita Outra. O editor de vaga permite texto livre de área, com sugestões. Conteúdo de cultura e áreas gerais ainda exige alteração do código.

### Cadastro e publicação de vagas

Campos existentes: título, slug, área/departamento, local, modelo presencial/híbrido/remoto, contratação, horário, resumo, descrição, responsabilidades, requisitos, diferenciais, estado, abertura, encerramento e prioridade.

Estados: `rascunho`, `publicada`, `encerrada`. Menor prioridade aparece primeiro, depois abertura mais recente e título. O servidor gera slug a partir do título quando necessário e evita duplicidade. Depois da primeira publicação, o slug fica fixo e a vaga não volta a rascunho; para tirá-la do ar usa-se encerrada, preservando links. É possível republicar após ajustar o prazo.

O prazo final é efetivo: uma vaga publicada deixa de ser aberta quando ele vence, tanto para a listagem como para o recebimento do formulário. Isso é calculado na consulta, sem depender de cron para trocar o estado persistido. Datas do formulário são convertidas em dias de Fortaleza; encerramento corresponde ao fim do dia. **A data de abertura hoje é informativa e de ordenação: não é agendamento de publicação**, porque as condições de visibilidade verificam estado e encerramento, não uma abertura futura.

Páginas abertas geram metadados `JobPosting`, endereço canônico e podem entrar no sitemap. Rascunho não tem página pública. Vagas fechadas não são indexadas. O conteúdo textual é exibido como texto, sem editor HTML arbitrário.

Fontes: `src/lib/hr.functions.ts`, `src/lib/careers.server.ts:38`, `src/lib/careers.server.ts:56`, `src/lib/careers.server.ts:95`, `src/lib/careers.functions.ts`, `src/routes/carreiras.index.tsx`, `src/routes/carreiras.vagas.$slug.tsx`, `src/routes/_authenticated/interno.vagas.index.tsx`, `src/routes/_authenticated/interno.vagas.$id.tsx`.

### Como chega uma candidatura

1. Candidato informa nome, e-mail, WhatsApp/telefone, cidade/UF, LinkedIn opcional, apresentação opcional e PDF obrigatório. No banco também pode selecionar área de interesse.
2. Na vaga, aceita o uso dos dados para aquela seleção; há caixa separada e opcional para também ficar no banco. No cadastro espontâneo, o consentimento é específico para banco de talentos. As opções não vêm pré-marcadas.
3. O servidor valida campos e, se houver vaga, verifica novamente se está aberta e obtém título, ID e área do banco. O título vindo do navegador não é confiado.
4. São aplicados honeypot e limites: até 5 solicitações por IP em 15 minutos e 5 por e-mail em 24 horas. Turnstile está preparado e somente é exigido quando habilitado e configurado; não presumir que está ativo na VPS.
5. O servidor aceita até 5 MB, verifica assinatura `%PDF-` e recusa marcadores explícitos de JavaScript, execução, anexos e outros conteúdos ativos. Essa checagem existe, mas não equivale a antivírus ou análise completa de PDFs.
6. O arquivo recebe nome aleatório e fica fora da pasta pública, em `SITE_DATA_DIR/resumes/AAAA-MM/<uuid>.pdf`. O nome original não vira caminho. São usadas permissões restritas na VPS.
7. A candidatura é gravada em `job_applications` com estado `novo`, protocolo, conteúdo validado, vínculo da vaga, finalidade, indicação de banco e data do consentimento. Se a gravação falhar depois do upload, o arquivo é descartado.
8. A aplicação tenta avisar o DHO por e-mail. O protocolo confirma o registro no banco, não a entrega de e-mail nem uma contratação. A resposta ao candidato informa que o DHO analisará e entrará em contato caso haja aderência.

O candidato não cria conta nem acompanha andamento por portal próprio. O protocolo é exibido ao final; não há consulta pública identificada por protocolo.

Fontes: `src/components/site/ApplicationForm.tsx`, `src/lib/leads.functions.ts:96`, `src/lib/leads.functions.ts:118`, `src/lib/security.server.ts`, `src/lib/local-db.server.ts:304`.

### Operação das candidaturas no painel

O painel usa tabela com duas abas: Vagas e Banco de talentos. Vagas contém candidaturas vinculadas a uma vaga; Banco inclui cadastros espontâneos, candidatos que marcaram também-banco e registros colocados manualmente em `banco de talentos`. Por isso, a mesma candidatura pode aparecer nas duas abas; não é necessariamente duplicação no banco.

Filtros: estado, nome, área/interesse ou título, cidade, vaga e intervalo de datas. A interface usa seletor de vaga na aba Vagas e campo de área na aba Banco. O resultado é limitado aos 300 registros mais recentes por consulta; não há paginação identificada.

Estados atuais: `novo`, `em análise`, `contato realizado`, `entrevista`, `banco de talentos`, `encerrado`. São escolhidos manualmente com notas internas de até 5 mil caracteres; não há máquina de etapas que obrigue uma sequência. O detalhe mostra dados do candidato, vaga, consentimento, finalidade, previsão de retenção, mensagem e botão para baixar PDF. Não há campos específicos de aprovado/reprovado, avaliações, notas estruturadas de entrevista, responsável, próxima ação ou data de entrevista.

O PDF é retornado como anexo com `private, no-store`, proteção contra detecção de MIME e política restrita; o caminho interno não é enviado à tela. Cada download é auditado. O caminho não é link público compartilhável.

Fontes: `src/lib/admin.functions.ts:12`, `src/lib/admin.functions.ts:137`, `src/lib/admin.functions.ts:177`, `src/lib/admin.functions.ts:195`, `src/lib/admin.functions.ts:204`, `src/routes/_authenticated/interno.candidaturas.index.tsx`, `src/routes/_authenticated/interno.candidaturas.$id.tsx`, `src/routes/api.interno.curriculo.$id.ts`.

### Retenção e finalidade

O código calcula previsão de expiração a partir do recebimento: `RECRUITMENT_RETENTION_MONTHS` para candidatura só à vaga; `TALENT_BANK_RETENTION_MONTHS` para banco ou vaga+banco. Valores válidos vão de 1 a 120 meses. Sem prazo próprio do banco, usa o da vaga; sem prazo configurado, não calcula expiração. **Não existe exclusão automática.**

`scripts/recruitment-retention.mjs` abre o banco somente para leitura, gera relatório com protocolos, finalidade, presença de currículo e vencimentos e informa `apagadas: 0`. Os testes de `tests/retention.test.mjs` cobrem ausência de política, prazos distintos, meses e anos bissextos e ausência de exclusão. Não se deve apresentar esse script como rotina de descarte já implementada.

A interface orienta o candidato a pedir acesso, correção ou exclusão por e-mail institucional. Não foi identificada uma ferramenta no painel para concluir esses pedidos. Um ponto a revisar: mover apenas o estado para Banco de talentos inclui o registro nessa aba, mas não registra novo aceite e não muda os campos usados para calcular finalidade e prazo. Classificação operacional e autorização/finalidade devem ficar explícitas em uma evolução.

Fontes: `src/lib/retention.ts:26`, `src/lib/retention.ts:32`, `src/lib/retention.ts:38`, `scripts/recruitment-retention.mjs`, `tests/retention.test.mjs`.

## 2. Autenticação e permissões atuais

Autenticação é própria do institucional, em SQLite. Não depende do login de BIomie, Leantime ou Supabase. Cada conta pode ter mais de um papel; as permissões são somadas. Não existe cadastro público de usuários do painel.

| Função | Admin | Comercial | DHO |
|---|---|---|---|
| Painel inicial e Minha conta | Sim | Sim | Sim |
| Solicitações de orçamento e contatos | Sim | Sim | Não |
| Consulta de produtos e orçamentos internos | Sim | Sim, com regras próprias de responsabilidade do módulo | Não |
| Vagas e candidaturas, banco e currículos | Sim | Não | Sim |
| Redes e Árvore de links | Sim | Não | Não |
| Configuração Omie, emitente de proposta e usuários | Sim | Não | Não |

O menu esconde áreas não autorizadas. A segurança também é feita no servidor a cada função; esconder menu não é o controle principal. O layout autenticado consulta a sessão antes de abrir rotas. Download de currículo repete a autorização por sessão em sua própria rota. A leitura de dados de DHO não é liberada ao papel Comercial.

### Gestão de usuários

Somente administrador cria contas, define um ou mais perfis, redefine senha de outra pessoa e desativa outra conta. O administrador não pode remover o próprio perfil Admin nem desativar a própria conta. A tela lista contas ativas, até 200. Desativação conserva a conta para manter vínculos e auditoria; não é apagamento. Não há ação de reativação identificada nessa interface.

Senhas exigem 12 a 256 caracteres, maiúsculas, minúsculas e números. São derivadas por scrypt com salt aleatório; não ficam legíveis no banco. A senha inicial/redefinida é definida pelo administrador e deve ser transmitida por canal adequado. Apesar de ser chamada de provisória na interface, **não há exigência identificada de troca obrigatória no primeiro acesso**.

Cada pessoa pode trocar a própria senha informando a atual. A mudança encerra todas as suas sessões e pede novo login. Troca de perfil, redefinição administrativa e desativação também invalidam as sessões da pessoa afetada.

### Sessões e proteção das requisições

Sessão dura 8 horas; o token tem 32 bytes aleatórios e somente seu hash SHA-256 é armazenado. A sessão consulta conta e papéis atuais do banco e não aceita conta desativada. Há limite de 10 sessões recentes por conta. Cookie `mag_site_session`: HttpOnly, SameSite=Lax e Secure em produção; respostas de sessão usam `private, no-store`.

Login tem limites de 20 tentativas por IP em 15 minutos e 10 por conta nesse intervalo, com resposta genérica para credenciais inválidas. A troca da própria senha tem limite de 5 em 15 minutos. Isso é limitação de tentativas, não um processo administrativo de desbloqueio de conta. Há middleware CSRF para funções do servidor com validação de origem.

Não foram identificados MFA, autenticação corporativa/SSO, verificação de e-mail, convite com token, recuperação de senha por link, painel de dispositivos ou revogação individual de sessões pelo usuário. São evoluções possíveis, não recursos atuais.

Fontes: `src/lib/local-auth-core.server.ts`, `src/lib/local-auth.server.ts`, `src/lib/auth.functions.ts`, `src/lib/admin.functions.ts:222`, `src/lib/admin.functions.ts:230`, `src/lib/admin.functions.ts:239`, `src/lib/admin.functions.ts:248`, `src/components/interno/ui.tsx`, `src/routes/_authenticated/route.tsx`, `src/routes/_authenticated/interno.usuarios.tsx`, `src/start.ts`.

## 3. Auditoria e notificações

Existe tabela `audit_log` com ator, ação, alvo, data e detalhes técnicos opcionais. São auditados login, criação/bootstrap de conta, mudanças de perfil e senha, desativação, criação/alteração/estado de vaga, alterações de candidatura e download de currículo, além de ações comerciais documentadas no relatório específico. Os eventos de alteração de candidatura são genéricos (`update:job_applications`); hoje não formam um histórico estruturado de estado anterior/novo com comentários em linha do tempo. Não foi identificada tela geral de auditoria. Logout não tem evento explícito no fluxo examinado.

Notificações de entrada usam Resend, com endereço de DHO configurável e padrão `dho@magmoveiscorporativos.com.br`. Precisam de `RESEND_API_KEY` e remetente verificado `EMAIL_FROM`; a URL do painel é opcional. Há suporte de código ao gateway de conector Lovable quando configurado; na VPS o caminho normal é chamada direta ao Resend. Isso não muda a fonte de verdade: candidatura salva no SQLite continua existindo se o e-mail falhar.

O e-mail de candidatura traz protocolo, contato, vaga/área, mensagem e link para painel quando configurado; não anexa o currículo. Não foram identificados fila persistente, tentativas posteriores automáticas, painel de entrega, webhook de entrega nem resposta automática ao candidato. O provedor é chamado durante a requisição e erros são registrados em log, sem desfazer o cadastro.

Fontes: `src/lib/local-db.server.ts:236`, `src/lib/local-db.server.ts:273`, `src/lib/email/notify.server.ts`, `src/lib/email/resend-provider.server.ts`, `src/lib/email/templates.server.ts`, `src/config/notifications.server.ts`.

## 4. Recomendações separadas do que existe

### Visual e navegação para o Lovable

- Separar menu em Comercial, Pessoas, Conteúdo e Administração; manter visibilidade por papel e destaque da unidade quando aplicável.
- Dashboard DHO com pendências, candidatos sem contato, vagas por estado e entrevistas próximas; cada indicador precisa de definição e dado real do motor.
- Adicionar visão Kanban por fase além da tabela; preservar filtros, alternativa acessível por teclado e confirmação de mudanças relevantes.
- Ficha de candidato com abas Perfil, Candidaturas, Currículo, Interações e Finalidade/Retenção; mostrar uma linha do tempo clara.
- Editor de vagas com prévia pública, checklist de campos, indicação clara de rascunho/aberta/encerrada e separação entre publicação e período de inscrições.
- Usuários com formulário de convite, matriz de permissões, confirmação clara das consequências ao retirar acesso e listagem de desativados.

### Motor e dados para evolução

- Entidade Pessoa/Candidato separada de Candidatura para reconhecer múltiplas candidaturas sem sobrescrever histórico, com deduplicação controlada.
- Etapas configuradas de seleção, responsável, tarefas, próxima ação, agendamento e registro de decisão; não avaliar/descartar automaticamente pessoas por critérios sem definição da MAG.
- Paginação, ordenação no servidor e índices para crescer além dos 300 resultados; relatórios com métricas definidas.
- Histórico estruturado de transições e comentários com quem/quando, além de auditoria técnica; controle de concorrência para não perder notas editadas por duas pessoas.
- Separar entrada no banco de talentos de mera troca de status, com evidência da opção do candidato, renovação/retirada e política de retenção aplicável.
- Rotina revisável de pedidos de acesso/correção/exclusão e descarte, com tratamento de arquivos e backups segundo política aprovada; não habilitar exclusão automática só porque existe cálculo de expiração.
- Fila de notificações com repetição, idempotência e painel de resultado; confirmação ao candidato e convites de entrevista como novos canais, se aprovados.
- Agendamento real de publicação de vagas, caso desejado: hoje a abertura futura não segura a publicação.
- Convites de acesso com token e expiração, troca obrigatória de senha inicial, recuperação segura, MFA e gestão de sessões; permissões por ação/unidade se o negócio precisar.
- Testes de DHO e de autenticação dedicados para regras de vaga, formulário/PDF, matriz de acesso e transições. Há testes de retenção existentes; não foi localizada suíte dedicada completa de recrutamento/autenticação entre os arquivos examinados.

### Restrições úteis para o briefing do Lovable

Reutilizar funções do servidor e regras reais; a entrega visual não deve criar um segundo login, outro banco ou telas que aparentem enviar e-mails/alterar candidatos sem integração. Manter credenciais no servidor e currículos privados. Propostas de Supabase devem ser tratadas como migração de arquitetura, com decisão explícita, não troca incidental durante redesign. Preservar isolamento dos demais sistemas da VPS e do BIomie. Qualquer funcionalidade acima precisa de escopo, dados e critérios de aceite próprios antes de ser descrita como existente.
