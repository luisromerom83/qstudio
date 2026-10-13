FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY portal/ ./portal/
COPY cases/ ./cases/
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
