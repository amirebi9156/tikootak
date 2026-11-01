FROM node:20-bookworm-slim
# سرور ایران ممکن است به deb.debian.org / registry.npmjs.org دسترسی نداشته باشد؛ آینه‌ها را می‌شود از .env داد (اختیاری)
ARG APT_MIRROR=
ARG NPM_REGISTRY=
# ffmpeg برای تبدیل ویدیو (فقط بسته‌های ضروری؛ ffprobe هم همراهش نصب می‌شود)
RUN if [ -n "$APT_MIRROR" ]; then sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; fi \
 && apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev ${NPM_REGISTRY:+--registry $NPM_REGISTRY}
COPY src ./src
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
