# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci

COPY tsconfig.json ./
COPY src ./src/

RUN npx prisma generate
RUN npm run build

# ---- Production stage ----
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma/

RUN mkdir -p /app/uploads

ENV NODE_ENV=production
ENV PORT=3004

EXPOSE 3004

CMD ["node", "dist/index.js"]
