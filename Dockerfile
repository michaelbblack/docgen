FROM node:22-slim

# Install Chromium dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
    fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Install Playwright Chromium
RUN npx playwright install chromium

COPY . .

EXPOSE 3000
ENV PORT=3000
ENV CHROME_PATH=""

# Auto-detect Playwright's Chrome at startup
CMD ["sh", "-c", "export CHROME_PATH=$(find /root/.cache/ms-playwright -name 'chrome' -type f | head -1) && node src/server.js"]
