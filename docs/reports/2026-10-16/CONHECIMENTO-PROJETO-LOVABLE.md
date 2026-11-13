# Conhecimento do projeto — MAG

Base verificada em 16/10/2026. Este texto é contexto persistente para evoluir um sistema existente. O relatório completo e o briefing detalham fatos e propostas.

## Produto e infraestrutura

- Site público: https://magmoveiscorporativos.com.br. Painel: /interno. Árvore: /links/; editor /interno/links.
- React 19 + TypeScript + TanStack Start/Router + React Query + Tailwind/Radix. Rotas em src/routes; manter convenções TanStack, não criar estrutura Next.js.
- Backend Node 24/Nitro node-server, banco próprio SQLite via node:sqlite. Site e painel pertencem à mesma aplicação.
- Deploy em Docker/Nginx na VPS; projeto mag-site, diretório /opt/mag-site. BIomie e Leantime têm sistemas/bancos/login separados.
- Não há Supabase operacional no fluxo atual. Referências de AGENTS.md/roadmap e dependência/pasta antigas não significam backend ativo. A decisão da MAG é banco próprio na VPS.
- Localidade pt-BR, dinheiro BRL, datas operacionais America/Fortaleza.

## Permissões

- Papéis somáveis: admin, comercial, dho. Autenticação própria; autorização efetiva em cada operação no servidor.
- Admin administra usuários, configurações, emitente, Omie, redes e árvore; acessa Comercial e DHO.
- Comercial acessa todos os leads/contatos da fila, mas apenas os próprios orçamentos internos e propostas. Admin vê todos.
- DHO administra vagas, candidaturas, banco de talentos e currículos; Comercial não lê esses dados.
- Sessões de 8 h; cookies seguros; senhas com scrypt. Não trocar esse mecanismo por um login fictício na interface.
- MFA, recuperação por link e troca obrigatória de senha inicial são propostas, não recursos atuais.

## Comercial e propostas

- Solicitação pública de orçamento é lead, não venda nem negociação interna pronta.
- Lead: quote_requests + quote_request_items. Contato: contact_requests. Negociação: internal_quotes + internal_quote_items, com proprietário.
- Converter lead copia dados e cria negociação. Status não se sincronizam automaticamente; o mesmo lead pode gerar mais de uma negociação.
- Número interno MAG-Q-AAAA-NNNNN. Estados: rascunho, salvo, enviado, aceito, enviado_omie, erro_omie, cancelado.
- Preços são digitados pela equipe. Valores oficiais e descontos calculados no servidor em centavos; quantidade até três casas decimais.
- Proposta = snapshot versionado v1/v2 etc. em quote_proposals. Uma vigente; histórico, comparação e exclusão lógica com regras.
- Total do PDF = itens após descontos individuais - desconto geral + frete + montagem.
- O dono do orçamento é o consultor da proposta; Admin pode executar ações sem substituir a autoria comercial.
- Perfil comercial tem contatos opt-in. Nome tem fallback; telefone/WhatsApp/e-mail só aparecem se cadastrados e autorizados para exibição.
- PDF privado, gerado no servidor. Snapshot preserva dados; o PDF binário não é arquivado de forma imutável hoje.
- Abrir WhatsApp/e-mail inicia compartilhamento, não comprova envio/leitura. Marcar enviada é explícito. Aceite é registrado internamente e ligado à versão.
- Sem portal de aceite/assinatura eletrônica e sem API WhatsApp de anexos atualmente. Não simular como recurso integrado.
- Previsão e conteúdo aceitos ficam protegidos. Alteração exige revisão/proposta/aceite apropriados.

## Omie e catálogo

- Credenciais só no servidor e nos componentes autorizados. Nunca em prompt, frontend, VITE_*, dados mock ou repositório.
- Visitantes leem catálogo local sincronizado, não consultam Omie por visita.
- Público: price=null; apenas rótulo Pronta entrega/Disponível/Sob consulta. Nunca quantidade exata, custos, margem ou locais internos.
- Painel Consulta rápida pode consultar índice completo e estoque sob demanda via omie-consulta, com cache/limites.
- omie-pedidos é o componente de escrita controlada; OMIE_ORDER_WRITE_ENABLED está false na produção verificada.
- Pedido depende de cliente confirmado, vendedor vinculado ao dono, conta/pagamento/etapa/categoria, revisão e confirmação. Manter idempotência e tratamento de resultado incerto.
- Frete e desconto geral no pedido estão preparados porém desligados. Montagem não tem regra fiscal definida. Esses extras bloqueiam a conversão hoje.
- O motor não fatura, não emite NF, não gera Pix/cobrança e não reserva estoque.
- Revisar estoque deve somar linhas do mesmo produto; a conferência atual por linha é uma lacuna identificada a corrigir com teste.
- Produto usa foto do próprio SKU; sem foto, imagem neutra. CMS editorial ainda não existe no painel; camada de arquivo é prevista no sincronizador.

## DHO

- Escopo atual é recrutamento. jobs e job_applications; PDF de currículo privado até 5 MB.
- Vaga: rascunho/publicada/encerrada; prazo final restringe inscrição. Data de abertura não agenda publicação hoje.
- Candidatura: novo, em análise, contato realizado, entrevista, banco de talentos, encerrado; notas e filtros.
- Consentimento para vaga e banco têm finalidades distintas. Mudar status para banco não registra consentimento novo.
- Retenção calcula vencimento, sem exclusão automática. Prazos de vaga/banco estão sem configuração na produção.
- Agenda, avaliações, responsável, linha do tempo e descarte assistido são propostas novas.

## Conteúdo e árvore

- CMS parcial: árvore, redes e vagas têm painel; páginas institucionais, home, blog/projetos e contato global ainda dependem de código/config.
- Unidades da árvore não são cadastro global/fiscal. Rodapé/contato e emitente da proposta têm fontes diferentes; unificação é evolução.
- Contato público do vendedor é independente da conta de acesso/perfil de proposta/vendedor Omie. Publicação exige controle do Admin.
- Árvore tem rascunho, prévia, publicação, snapshots imutáveis e restauração para novo rascunho. Público nunca lê o rascunho.
- Tipos: link, WhatsApp, vendedor, unidade e heading; até 100 blocos. Unidades com cor/mapas/fixo/WhatsApp separados; vendedores agrupados por vínculo.
- Fundos: tema fixo, calendário de 12 meses ou imagem própria; capa/logo independentes. Calendário mensal não é agendamento de campanha.
- Imagens processadas no servidor e privadas até publicação; referência retirada deixa de ser pública. Upload atual recusa animação e PDF.
- QR permanente /links/qr.svg; filtro por unidade não está no URL. URLs/QR de vendedor/unidade são novos.
- Banners clicáveis, carrossel, promoções, vigência de campanha e métricas de cliques ainda são propostas.
- Redes têm modos manual/api/desligado. Os quatro padrões atuais são manuais; credencial presente não ativa a rede automaticamente.

## Regras para evolução

- Reconciliar projeto/repositório/branch com a base da VPS antes de integrar. Metadados de template não provam sincronização ativa.
- Reaproveitar regras/server functions. Não são uma API REST genérica: definir contratos se houver frontend separado.
- Modernizar visual e modularizar motor sem sobrescrever dados, propostas, vínculos ou arquivos existentes.
- Separar protótipo com fixtures da integração real. Se a prévia não executar Node/SQLite, explicitar a limitação em vez de migrar silenciosamente para Cloud.
- Não ativar escrita Omie, notificações reais, preço público ou migração de banco como efeito colateral do redesign.
- E-mails de avisos e envio direto de proposta não funcionam na produção atual por ausência de provedor/remetente.
- Novas funcionalidades precisam declarar modelo, autorização, transições, migração e critérios de teste.
- Priorizar cadastro global de unidades, relação lead/negociação, fluxo de proposta, estoque agregado, CMS/campanhas e recrutamento organizado.
