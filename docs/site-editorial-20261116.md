# Site institucional MAG — atualização editorial

Material visual: pasta `41b02410-ac16-4787-b177-13906f319d2c` fornecida pelo proprietário.
Release: `20261116-site-editorial`. Base: `20261113-linktree-v20`.

## Escopo

Apresentação editorial na página inicial, navegação, rodapé, páginas institucionais,
catálogo, produto, contato, orçamento e carreiras. Os dados e serviços atuais da MAG
permanecem responsáveis por catálogo Omie, imagens por SKU, orçamento, formulários,
vagas, unidades e conteúdo social. Nenhum dado demonstrativo do protótipo é publicado.
Não há arquivo de vídeo no material recebido: a abertura usa a imagem existente.

CSS novo restrito a `.public-site`, incluindo os portais de menu e busca.
O gerencial, a árvore de links e os conectores não recebem o tema institucional.
As variantes `film` e `editorial` do botão são aditivas.

## Gerenciamento

Administrador: `/interno/conteudo`.

- Banner principal: imagem desktop/celular, texto, formato, alinhamento e botões.
- Blocos da página inicial: ordem, visibilidade, cor de fundo, imagens, chamadas e links.
- Novo Manifesto: textos, imagem, botão e complemento.
- Novo Processo: apresentação e até oito etapas, editáveis e reordenáveis.
- Mantidos banners agendados, SEO, menu, marca, contatos, prévia privada e publicações.

Documentos antigos completos de 15 seções são expandidos na leitura com Manifesto e
Processo, preservando conteúdo e ordem relativa das seções existentes. O JSON das
publicações anteriores não é regravado. Rascunhos continuam privados até publicação.
Seções editoriais ocultas têm também seus textos auxiliares removidos da resposta pública.
As demais páginas institucionais preservam suas fontes atuais; seus textos estáticos
continuam no código, sem simular um editor inexistente.

## Isolamento da entrega

Fonte preparada a partir do pacote da versão efetivamente publicada. O manifesto do
release recusa mudanças fora da lista de arquivos públicos/CMS autorizados, arquivos
removidos e alterações de CRM, autenticação, Omie, WAHA ou árvore de links.
Sem novas dependências, credenciais, variáveis de ambiente, rotas de integração,
migração de dados, escrita no Omie ou pareamento WhatsApp.

## Validação e implantação

Evidências de build, testes CMS/compatibilidade/SSR/SEO, catálogo e árvore de links,
capturas responsivas e prova Linux ficam na pasta operacional `MAG-SITE-NOVO-20261116`.
Homologação Linux usa rede Docker `none`, dados artificiais e escrita Omie desabilitada.

Implantar somente o serviço `web`, usando imagem versionada e já construída. Antes da
troca, executar `/srv/mag-site/backup.sh` e conferir integridade do arquivo com `gzip -t`.
Registrar hashes de publicações/rascunhos do CMS e árvore de links, QR, compose/Nginx
e identidade dos serviços Omie e WAHA. Verificar novamente depois da troca.

## Recuperação

O relatório operacional registra tag anterior, backup e ambiente anterior protegido.
Para reverter somente a apresentação, restaurar `MAG_SITE_TAG=20261113-linktree-v20`
em `/opt/mag-site/.env` e executar na VPS:

```sh
docker compose --project-directory /opt/mag-site up -d --no-deps --pull never --wait web
```

Não restaurar o banco automaticamente: isso descartaria trabalho comercial posterior.
O banco e os anexos permanecem nos volumes existentes. Se o administrador publicar
conteúdo com os novos blocos, uma reversão de código deve considerar o esquema CMS
estendido; manter o código atualizado e restaurar uma publicação pela interface é a
recuperação preferível para alterações de conteúdo. Uma reversão emergencial completa
do esquema deve ser planejada sem apagar publicações imutáveis ou dados comerciais.

A saúde interna é consultada pelo serviço; a restrição pública de `/api/health` no
Nginx permanece. Os serviços Omie e WAHA não devem ser recriados para esta entrega.
