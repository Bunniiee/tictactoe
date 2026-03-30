FROM node:20-alpine AS builder

ARG VITE_NAKAMA_URL=http://localhost:7350
ENV VITE_NAKAMA_URL=${VITE_NAKAMA_URL}

WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
