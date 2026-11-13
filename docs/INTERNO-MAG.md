# Painel MAG — operação e integração

Implementação de 16/10/2026. O visual de `Site - interno` foi integrado ao sistema operacional em `SITE MAGMOVEIS INSTITUCIONAL`, com banco SQLite próprio e os serviços existentes da VPS.

## Acesso e perfis

O endereço operacional continua `/interno`. O menu usa o usuário autenticado e os perfis reais, somáveis:

- **Admin:** administração do site, usuários, emitente, Omie, unidades, marketing e todas as negociações.
- **Comercial:** solicitações, contatos, produtos e suas próprias negociações/propostas.
- **Gerente:** fila de aprovação de descontos dentro da alçada configurada. Os demais acessos dependem dos perfis somados; este perfil não concede acesso ao DHO ou à gestão de usuários.
- **DHO:** vagas, candidaturas, currículos privados, entrevistas e avaliações.

O menu móvel usa diálogo com controle de foco e Escape. A busca respeita essas permissões. Sair revoga a sessão no servidor.

## Administração

`/interno/admin` reúne cinco abas: Usuários, Emitente, Descontos, Integrações e Auditoria. Gerente acessa somente Descontos.

**Usuários:** contas podem ser desativadas e reativadas sem apagar histórico. Mudanças de perfil e desativação revogam sessões. O último administrador ativo é protegido. Convites têm link de uso único, válido por 72 horas, com token no fragmento da URL e somente seu hash no banco. A pessoa escolhe a senha e depois entra pelo login normal.

O envio de convite por e-mail usa o provedor já existente quando `RESEND_API_KEY` e `EMAIL_FROM` estão configurados. Sem essa configuração, a interface informa que o administrador deve copiar e entregar o link; não registra envio fictício.

**Emitente:** razão social, CNPJ, inscrição estadual, contatos, endereço, validade, rodapé, dados bancários e PIX. A prévia acompanha a edição. Os campos entram nas próximas versões de proposta; documentos antigos preservam o retrato gravado.

**Descontos:** limites de Consultor, Gerente e Diretoria (Admin), simulador, fila de aprovação e justificativa. O sistema considera cada item, o desconto geral e seu efeito acumulado. O arredondamento em centavos preserva a alçada do percentual digitado.

Os números 5%, 10% e 15% são valores iniciais de exemplo. **A política começa desativada até a MAG confirmar e salvar seus limites reais.** Quando ativa, desconto pendente ou recusado bloqueia envio, aceite e download para distribuição. A prévia interna continua disponível. Mudanças nos valores financeiros ou na política exigem nova aprovação; alterações posteriores à proposta também exigem nova versão do documento. Valores acima da alçada máxima são recusados ao salvar.

**Integrações:** preserva consultas Omie, vínculos de vendedores e controles existentes. A escrita de pedidos continua dependente da configuração operacional e desligada por padrão.

**Auditoria:** consultas com filtros e paginação; não há operação de editar/apagar eventos no painel. Detalhes exibidos são filtrados; tokens, senhas, mensagens e currículos não aparecem no histórico técnico.

## Comercial

`/interno/atribuicao` permite atribuição manual e configuração por unidade ou rodízio. Novas solicitações usam as regras ativas e consultores elegíveis. O modo inicial é manual. A conversão respeita o responsável e reutiliza a negociação já criada para a solicitação, evitando duplicações. Contatos continuam no módulo próprio.

As negociações preservam cálculo no servidor, revisão concorrente, controle por proprietário, condições, frete, montagem, versões e aceite. A revisão de estoque soma linhas do mesmo produto e trata quantidades fracionárias em milésimos.

`/interno/orcamentos-internos/<id>/pdf` exibe o mesmo PDF protegido usado para baixar e imprimir. Não existe documento paralelo com cliente ou totais fictícios. Abrir WhatsApp/e-mail inicia um compartilhamento; o envio e o aceite continuam sendo ações explícitas vinculadas à versão.

## DHO

Candidaturas têm lista e funil com movimentação por arraste ou seleção. Alterar etapa preserva notas e consentimentos. Mover para banco de talentos não cria consentimento novo.

`/interno/entrevistas` oferece agendamento, entrevistador, unidade/sala ou reunião online, duração, situação, nota de 1 a 5 e observações. O servidor confere intervalos sobrepostos de candidato, entrevistador e local. Datas usam Fortaleza. Avaliações são permitidas depois da realização. Currículos permanecem privados, com as regras anteriores de acesso e retenção informativa.

## Unidades, árvore e campanhas

`/interno/unidades` centraliza os dados de Centro e BR-116. A inicialização preserva os identificadores das unidades já publicadas. Endereço, fixo, WhatsApp, mapas, horários e situação refletem no contato institucional, rodapé e árvore. O cadastro não infere emitente fiscal da proposta.

`/interno/links` preserva vendedores por unidade, fotos, mapas, fundo próprio, temas dos 12 meses, rascunho, publicação, histórico, restauração e conflitos de edição. `/links/` e o QR permanente continuam válidos.

`/interno/campanhas` usa o mesmo ciclo de rascunho/publicação. Há até três banners, artes para computador/celular, destino seguro personalizado, catálogo ou WhatsApp, unidade, ordem, ativação e vigência. Blocos também podem ter início/fim. O carrossel oferece controles, pausa, toque e respeito à preferência por movimento reduzido. Imagens de rascunho ou fora da publicação/vigência não são entregues publicamente.

`/interno/metricas` apresenta agregados reais, por período. Cliques e exibições não são vendas ou visitantes únicos. Campanhas usam identificadores UTM nos destinos; os formulários preservam a origem recebida. Comercial recebe dados do seu escopo; marketing completo é exclusivo do Admin. Não são gravados IP, cookie ou agente do visitante nas tabelas de métricas.

## MFA e recuperação

`/interno/seguranca` permite ativação individual de TOTP com aplicativo autenticador, códigos de recuperação de uso único e gestão de sessões. A confirmação exige senha/código real; o login só cria sessão após o segundo fator quando ele está ativo. Há limites de tentativas e proteção contra reutilização.

O segredo TOTP fica criptografado com chave em `SITE_DATA_DIR/security/mfa.key`, fora do diretório público. O backup privado inclui `security.tar` junto ao SQLite, currículos e uploads. Uma restauração precisa devolver banco e chave correspondentes. Retornos operacionais devem usar uma versão que reconheça MFA quando houver contas com o recurso ativo.

## Isolamento e validação

O projeto continua no espaço próprio `/opt/mag-site`, com dados e credenciais separados de BIomie, Leantime e outros sistemas. A integração não copia credenciais Omie para a interface ou para o projeto visual.

As evidências locais ficam em `MAG INTERNO INTEGRACAO - 2026-10-16`: logs de build/TypeScript/testes, validação de PDFs A4, resultados de navegador e capturas. Os arquivos `qa-access.json` e `qa-security-access.json` são credenciais de homologação e não fazem parte do pacote de publicação.
