# Editor próprio do site MAG

Acesso: `/interno/conteudo`, no menu **Site e marketing → Editor do site**, para administradores.

## O que pode ser editado

- **Geral:** nome público, slogan, logotipo, ícone, contatos gerais, texto do rodapé, título e descrição para buscadores, imagem de compartilhamento e aviso superior.
- **Aparência e menu:** cor principal, cantos, largura, espaçamento, rótulos, ordem e exibição dos itens do menu.
- **Página inicial:** imagem para computador e celular, texto, botões e formatos do destaque principal; ordem, exibição, títulos, imagens, chamadas e formatos das seções; números institucionais.
- **Banners do site:** artes para computador e celular, ordem, textos, destino, largura, enquadramento e período de exibição no horário de Fortaleza.
- **Histórico:** versões publicadas que podem ser copiadas para o rascunho.

Produtos e disponibilidade continuam usando o catálogo existente. Endereços e contatos por loja ficam em **Unidades**; perfis sociais ficam em **Redes sociais**. A árvore de links mantém sua própria edição e publicação.

## Salvar e publicar

1. Faça as alterações e confira a prévia em computador ou celular.
2. Salve o rascunho. Isso não muda o site público.
3. Publique para disponibilizar a versão completa aos visitantes.

Uma restauração altera somente o rascunho. Confira e publique novamente para efetivar a versão restaurada. Se outra aba salvar primeiro, recarregue o editor antes de continuar para evitar sobrescrever o trabalho dela.

As imagens são preservadas por inteiro no envio. A opção de enquadramento define como são exibidas. Para campanhas, prefira artes horizontais no computador e uma versão própria para celular. Imagens de rascunhos e versões antigas permanecem privadas até serem usadas na publicação vigente.

## Operação e preservação

O conteúdo usa as tabelas `site_content_draft`, `site_content_publications` e `site_content_images` no banco próprio do site. Arquivos ficam em `data/site-uploads`, fora da pasta pública. Os scripts `deploy/srv/backup.sh` e `restore.sh` incluem essa pasta junto ao banco e às mídias históricas.

`/site-preview` exige administrador ativo e usa a mesma renderização do site com as imagens privadas. Ela não deve ser indexada. O Nginx deve permitir essa rota na lista de rotas válidas e aceitar frames da própria origem.

Sem uma publicação do CMS, o site usa os conteúdos originais definidos em `src/lib/site-content.ts`. Novas publicações não exigem compilação ou reinício. Implantações de código preservam banco e mídias; o objeto estático `src/config/site.ts` continua fornecendo os padrões dos módulos independentes, incluindo propostas e cadastro de unidades.
