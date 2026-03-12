FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    dbus \
    dbus-x11 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /tmp/whatsapp-sessions \
    && chmod 777 /tmp/whatsapp-sessions

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV DBUS_SESSION_BUS_ADDRESS=autolaunch:

WORKDIR /app

COPY package*.json ./

RUN npm install --only=production

COPY . .

RUN useradd -m -u 1001 appuser && \
    chown -R appuser:appuser /app /tmp/whatsapp-sessions

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["npm", "start"]
