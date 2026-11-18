# MAG — site institucional + CRM comercial

Uma aplicação só que atende duas audiências: o **site público** do Grupo MAG
(magmoveiscorporativos.com.br) e o **sistema interno** onde a equipe comercial trabalha —
CRM, funil, propostas, atendimento por WhatsApp, catálogo e RH.

No ar desde **02/10/2026**, em evolução contínua desde então.

**Stack:** TanStack Start (SSR), React, TypeScript, Tailwind, SQLite, Docker + nginx em VPS
Ubuntu. Integração com o ERP **Omie** e com o WhatsApp via **WAHA**.

**307 arquivos TypeScript · 45 rotas · 56 arquivos de teste**

---

## O site público

Catálogo vindo do Omie (sincronizado às 04:00), com galeria por SKU, categorias, ambientes,
busca com sugestões e tolerância a erro de digitação, blog, carreiras com banco de talentos,
orçamento público com protocolo, e SEO completo (canonical, JSON-LD, sitemap dinâmico).

Duas regras de produto que moldaram o código:

- **Nunca mostrar o que não se pode comprovar.** Seções sem dado real ficam escondidas em vez
  de exibir placeholder. Nada de depoimento, número de clientes ou certificação sem origem.
- **Estoque em três estados**, nunca em número: o site não promete quantidade que o ERP pode
  desmentir em uma hora.

**URLs permanentes:** `slugs.json` guarda o endereço de cada produto para sempre. Um produto
renomeado no ERP não perde o link que já foi indexado ou compartilhado.

## O sistema interno (`/interno`)

| Área | O que faz |
| --- | --- |
| **CRM comercial** | Meu dia, Atendimento, Funil, Clientes, Propostas, Integrações |
| **Atendimento** | WhatsApp real com visual de WhatsApp: texto, áudio, arquivos, PDF |
| **Funil** | Etapas com arraste; perda exige motivo, fechamento exige confirmação |
| **Propostas** | Motor próprio: versões, cálculo, alçadas, envio, aceite, PDF |
| **Orçamento → Omie** | Orçamento interno vira Pedido de Venda no ERP, só a partir do retrato aceito |
| **Produtos** | Consulta rápida ao Omie, tabelas de preço, índice completo |
| **Carreiras** | Candidaturas com PDF e LGPD, entrevistas, painel do DHO |
| **Conteúdo** | CMS do site, editorial, campanhas, árvore de links |
| **Administração** | Usuários, atribuição, auditoria, métricas, automações |

### Decisões que importam

- **A conversão para o ERP é congelada.** Quando uma proposta é aceita, o sistema guarda um
  *retrato* dela (orçamento + versão + `sha256`). O Pedido de Venda no Omie nasce só desse
  retrato, nunca do estado atual da tela. Uma revisão posterior não pode se reaceitar
  sozinha. Isso fechou uma brecha real encontrada em homologação.
- **Escrita no ERP é sempre uma janela explícita**, com vigia e identidade congelada. O padrão
  é escrita desligada.
- **Segredos nunca chegam ao navegador.** Há testes dedicados (`site-ssr.test.mjs`) cujo único
  trabalho é falhar se uma chave de API aparecer no HTML servido.
- **Conta corrente por venda**, não por cliente: foi o que fez o número bater com o ERP.

## Operação

`deploy/` traz o compose, o nginx, os cron, o logrotate e os scripts do host:

- `deploy.sh` — publica uma release e volta sozinho se a verificação falhar
- `omie-sync.sh`, `omie-indice.sh`, `omie-tabelas-preco.sh` — carga e índice do catálogo
- `saude-host.py` — vigia do host; `omie-alert.py` — alerta quando o ERP responde errado
- `social-sync.sh` + `social-simular-queda.sh` — redes sociais, com ensaio de queda
- `reboot-check.sh` — confere o que subiu depois de um reboot
- `waha/` — o conector de WhatsApp, com backup local e vigia a cada 5 minutos

## Branches

O fluxo real está preservado: `producao-real` é o que foi publicado, `modulos-comerciais` e
`etapa4-funil` são as rodadas de módulos comerciais e do funil profissional. `main` aponta
para o trabalho mais recente.

## Sobre esta cópia pública

O endereço real da VPS foi trocado pelo IP de documentação `203.0.113.10` (RFC 5737) e o
identificador da instância por `srv-vps`. Os contatos que aparecem são canais públicos da
empresa, já publicados no próprio site. Nenhuma credencial foi versionada em nenhum momento.

---

## Desenvolvimento

```sh
bun install
bun run dev
```

Testes: `bun run test`. Verificação completa antes de publicar: `npm run check:publish`.
