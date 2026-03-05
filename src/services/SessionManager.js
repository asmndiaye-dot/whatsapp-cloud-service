const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const WebhookService = require('./WebhookService');

class SessionManager {
    constructor() {
          this.sessions = new Map();
    }

  async createSession(userId) {
        if (this.sessions.has(userId)) {
                const existing = this.sessions.get(userId);
                if (existing.client) await existing.client.destroy();
        }

      const client = new Client({
              authStrategy: new LocalAuth({ clientId: userId }),
              puppeteer: {
                        headless: true,
                        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-accelerated-2d-canvas','--no-first-run','--no-zygote','--disable-gpu']
              }
      });

      const sessionData = { client, qrCode: null, status: 'disconnected', userId };
        this.sessions.set(userId, sessionData);

      client.on('qr', async (qr) => {
              try {
                        const qrDataUrl = await QRCode.toDataURL(qr);
                        sessionData.qrCode = qrDataUrl;
                        sessionData.status = 'qr_pending';
                        await WebhookService.sendWebhook('qr_updated', userId, { qrCode: qrDataUrl });
              } catch (error) {
                        console.error('Error generating QR code:', error);
              }
      });

      client.on('ready', async () => {
              sessionData.status = 'connected';
              const info = client.info;
              await WebhookService.sendWebhook('session_status', userId, { status: 'connected', phoneNumber: info.wid.user });
      });

      client.on('disconnected', async () => {
              sessionData.status = 'disconnected';
              await WebhookService.sendWebhook('session_status', userId, { status: 'disconnected' });
              this.sessions.delete(userId);
      });

      client.on('message', async (message) => {
              await WebhookService.sendWebhook('message_received', userId, {
                        from: message.from,
                        fromName: message._data.notifyName || message.from,
                        message: message.body,
                        messageId: message.id._serialized,
                        timestamp: message.timestamp
              });
      });

      await client.initialize();
        return sessionData;
  }

  getSession(userId) {
        return this.sessions.get(userId);
  }

  async sendMessage(userId, to, message) {
        const session = this.sessions.get(userId);
        if (!session || session.status !== 'connected') throw new Error('Session not connected');
        const chatId = to.includes('@c.us') ? to : `${to}@c.us`;
        const sentMessage = await session.client.sendMessage(chatId, message);
        return { success: true, whatsappMessageId: sentMessage.id._serialized };
  }

  async destroySession(userId) {
        const session = this.sessions.get(userId);
        if (session && session.client) {
                await session.client.destroy();
                this.sessions.delete(userId);
        }
  }
}

module.exports = new SessionManager();
