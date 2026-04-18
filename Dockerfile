FROM node:20-alpine

RUN apk add --no-cache openssl netcat-openbsd bash

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

COPY entrypoint.sh ./
COPY . .

RUN pnpm prisma:generate
RUN pnpm build



EXPOSE 3001

ENTRYPOINT ["bash", "/app/entrypoint.sh"]
CMD ["node", "dist/main"]

