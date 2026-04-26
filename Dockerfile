FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY server ./server
COPY shared ./shared
COPY frontend ./frontend
COPY contracts ./contracts
COPY tsconfig.json tsconfig.server.json tsconfig.worker.json ./

RUN npm run build

EXPOSE 3000

ENV PORT=3000
ENV ALLOW_REGISTRATION=true

CMD ["node", "build/server/index.js"]
