FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev
COPY packs ./packs
COPY runtime ./runtime
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r runtime/requirements.txt
RUN mkdir /app/data /app/workspaces && chown -R node:node /app/data /app/workspaces
USER node
EXPOSE 8789
WORKDIR /app/runtime
CMD ["/opt/venv/bin/uvicorn", "hub:app", "--host", "0.0.0.0", "--port", "8789", "--no-access-log"]
