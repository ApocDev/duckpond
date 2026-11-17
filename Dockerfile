FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.15.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:24-bookworm-slim
# Ducks use git and ripgrep through Claude Code and Codex.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code@2.1.322 @openai/codex@0.167.0
WORKDIR /app
COPY --from=build /app/.output ./.output
# Outfit drawing reads its reference duck and prompts from here.
COPY design ./design
# HOME holds Claude and Codex session files, so it lives on the data volume with the database.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3998 DUCKPOND_DATA_DIR=/data/duckpond HOME=/data/home
USER node
EXPOSE 3998
CMD ["node", ".output/server/index.mjs"]
