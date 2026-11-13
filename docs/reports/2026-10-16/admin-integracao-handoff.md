# Administração integrada — implementação local

16/10/2026. Esta frente não publica na VPS. Tudo foi integrado ao código e banco próprios do institucional, sem usar dados ou credenciais de outros sistemas.

## Unidades

`src/lib/units.ts` exporta `Unit`, `unitSchema`, `UNIT_ACCENTS`, `unitMapUrl` e `unitPhoneLabel`.

`Unit`: `{ id, name, address, whatsapp, phone, hours, mapUrl, wazeUrl, accent, active, revision }`. IDs são UUIDs; contatos usam 55 + DDD + número; campos não confirmados permanecem vazios. Cores: `red`, `blue`, `green`, `amber`.

`units.server.ts`: `listUnitsPublic(): Unit[]` (somente ativas), `getUnit(id, activeOnly=false): Unit|null`, `validateUnitId(id, activeOnly=true): Unit`, `listUnitsAdmin(actor): Unit[]`, `saveUnit(actor, input): Unit`. Os últimos dois conferem o papel atual no banco, não só no objeto recebido.

`units.functions.ts`: `getPublicUnits()`, `getAdminUnits()`, `saveAdminUnit({data: Unit})`.

Tabelas criadas quando necessário: `site_units` e `site_unit_history`. A gravação exige revisão atual; altera a revisão e mantém o histórico. Não existe exclusão pelo painel. Na primeira inicialização, o cadastro preserva os UUIDs das localizações Centro/BR-116 já publicadas, quando reconhecidas. Dados de Centro confirmados pelo usuário e BR-116 da configuração oficial são o fallback; não há horários fictícios. Fones legados de 10/11 dígitos recebem DDI 55.

Tela `/interno/unidades`. Rodapé e `/contato` usam dados desse cadastro. A integração da árvore com os UUIDs é feita pela frente de marketing. A unidade fiscal/emitente da proposta não é inferida nem alterada.

## Autenticador e sessões

`mfa.server.ts` implementa TOTP com primitivas `node:crypto`: RFC 6238/RFC 4226, HMAC-SHA1, seis dígitos, 30 segundos, tolerância de um intervalo e bloqueio de reutilização do último contador. Os vetores oficiais de oito dígitos, inclusive SHA256/SHA512, validam a construção do algoritmo nos testes; o fluxo operacional permanece SHA1/seis dígitos para os aplicativos comuns.

Referências primárias: [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238), [RFC 4226](https://www.rfc-editor.org/rfc/rfc4226).

O segredo de cada usuário fica cifrado com AES-256-GCM, nonce aleatório e autenticação adicional ligada ao ID do usuário. Chave aleatória de 32 bytes persistida em `SITE_DATA_DIR/security/mfa.key`; diretório 0700 e arquivo 0600 nos sistemas POSIX. Não publicar ou imprimir esse arquivo. **Backup e restauração precisam preservar banco e chave juntos**. A restauração não deve gerar uma chave substituta para segredos já existentes.

Tabela `user_mfa`, criada quando necessário. Cadastrar exige senha atual, configuração no aplicativo e confirmação de um código válido antes de ativar. Configuração pendente expira em dez minutos. Ativar/desativar revoga outras sessões e preserva a sessão que executou a operação. Desativação e renovação de recuperação exigem senha atual e código válido. Nenhuma conta existente recebe MFA obrigatório.

O login com senha válida retorna `{ok:false, challenge:'mfa'}` quando precisa do autenticador, sem emitir sessão. Somente uma verificação válida permite `startSession(user.id, true)`. `createSession` também recusa gerar sessão para uma conta com MFA ativo sem o indicador interno de verificação.

Cinco códigos inválidos bloqueiam novas tentativas por 15 minutos. Contadores de falha e códigos consumidos são persistidos com transação. Além disso, os endpoints mantêm os limites por IP/conta/operação. Oito códigos de recuperação aleatórios de 96 bits são exibidos uma vez, guardados apenas como hashes, consumidos individualmente; renovar invalida o conjunto anterior.

Tela `/interno/seguranca`: ativação real com QR gerado no servidor, confirmação, cópia/download local dos códigos, desativação, renovação e sessões próprias. Administrador vê situação de ativação da equipe sem acesso a segredos. Não há identificação de dispositivo ou IP inventada: sessões mostram início e expiração. `Minha conta` aponta à tela de segurança.

## Convites

`invitations.server.ts` e `invitations.functions.ts`; tabela `site_invitations` criada quando necessário.

Administrador ativo escolhe e-mail e papéis. Geração retorna uma única vez um link HTTPS do domínio oficial, com token aleatório de 256 bits no **fragmento**, por exemplo `/interno/convite#token=…`. O fragmento não é enviado em HTTP ou Referrer. O token bruto não fica no banco nem na auditoria; somente SHA-256. Limite: 72 horas e um único uso.

A tela pública `/interno/convite` lê e valida os 64 caracteres hexadecimais no navegador, guarda em memória e limpa o fragmento com `history.replaceState`. Tem `noindex,nofollow` e `no-referrer`. Consulta do convite e aceite usam POST, sem token na URL das chamadas. Atualizar a página depois da limpeza exige reabrir o link original.

Aceite permite apenas nome, senha forte e token; e-mail e papéis vêm do registro autorizado. Nunca promove ou sobrescreve conta existente. Não inicia sessão automaticamente. Após aguardar scrypt, a transação final confere novamente validade, revogação, uso, e-mail e se o administrador que emitiu o convite continua ativo com papel admin. Criar outro convite para o mesmo e-mail invalida pendentes anteriores. Revogar convite não altera uma conta já criada por outro convite aceito.

Seção em `/interno/usuarios` permite criar/copiar link e revogar pendentes; os últimos 100 convites aparecem com situação. Entrega manual, explicitamente sem envio automático de e-mail.

## Administração e auditoria

`/interno/admin` agrupa atalhos operacionais reais; não troca as rotas existentes.

`/interno/auditoria` usa `administration.server/functions.ts`, consultando `audit_log` atual com autorização admin atual, filtro por prefixo de ação e datas de Fortaleza, páginas de 50 eventos. Autor vem da conta interna correspondente; IDs e metadados do histórico passam por filtragem. Detalhes aceitam somente chaves técnicas previamente autorizadas, com valores numéricos/booleanos/nulos. Não são exibidos payloads, documentos, contatos de clientes, currículos, segredos ou mensagens antigas. IDs de formato desconhecido são omitidos para evitar vazar um documento usado incorretamente como alvo no passado.

## Validação desta frente

Comando: `node --test tests/administration-security.test.mjs tests/invitations.test.mjs`.

13 testes passaram: vetores RFC, segredo cifrado, confirmação em duas etapas, replay, recuperação de uso único/renovação, senha e código na desativação, bloqueio de falhas, sessão e revogação por proprietário, configuração expirada, permissão atual no banco, UUID/telefone de unidade legado, revisões/histórico, auditoria sem detalhes pessoais, token hash/fragmento/prazo, fraude de papel, conta existente, revogação/reuso e conferência final após hashing.

Esses testes usam diretórios e contas temporários, removidos ao concluir. A validação de navegador e a publicação pertencem à frente principal da integração.
