FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
RUN npm install --global bun@1.4.2
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY . .
ENV NITRO_PRESET=node-server VITE_SHOW_DEMO=false
RUN npm run build

FROM node:24.21.0-bookworm-slim AS production
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 TZ=America/Fortaleza
# sharp para os workers (WebP das fotos do Omie e das miniaturas das redes sociais) e para o site converter a foto do
# catálogo (WebP) em JPEG no PDF da proposta comercial (carregado de /app/scripts; sem ele, a proposta sai sem foto). Versão fixa.
RUN mkdir -p /app/scripts && cd /app/scripts \
 && printf '{"name":"mag-site-worker","private":true,"type":"module"}\n' > package.json \
 && npm install --no-save --no-audit --no-fund --omit=dev sharp@0.35.5 \
 && node -e "import('sharp').then((s) => console.log('sharp', s.default.versions.sharp, 'libvips', s.default.versions.vips))" \
 && npm cache clean --force
# Arquivos da aplicação pertencem ao root (somente leitura para o processo).
# O usuário de execução vem do compose (usuário dedicado "magsite" do host, nunca o UID 1000).
COPY --from=build /app/.output ./.output
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src/lib ./src/lib
COPY --from=build /app/src/config ./src/config
# O bootstrap versionado da árvore valida o conteúdo com a mesma versão usada no build.
COPY --from=build /app/node_modules/zod ./node_modules/zod
COPY --from=build /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
