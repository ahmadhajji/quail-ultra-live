FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY server ./server
COPY shared ./shared
COPY frontend ./frontend
COPY tsconfig.json ./
COPY web ./web

EXPOSE 3000

ENV PORT=3000
ENV ALLOW_REGISTRATION=true

CMD ["npm", "start"]
