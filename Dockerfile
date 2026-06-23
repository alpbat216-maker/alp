# Dockerfile
FROM node:18-bullseye

# ffmpeg kurulumu (sadece atempo fallback için yeterli)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# package.json kopyala ve bağımlılıkları kur
COPY package*.json ./
RUN npm ci --production

# Uygulama dosyalarını kopyala
COPY . .

# Upload/outputs dizinleri (runtime'da yeniden oluşturulabilir)
RUN mkdir -p uploads outputs || true

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
