const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const WebhookService = require('./WebhookService');

const SESSION_TIMEOUT = 10 * 60 * 1000;
const QR_TIMEOUT = 2 * 60 * 1000;

class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  getStats() {
    let active = 0;
    let pending = 0;
    let initializing = 0;

    this.sessions.forEach(session => {
      if (session.status === 'connected') active++;
      else if (session.status === 'qr_pending' || session.status === 'pairing_pending') pending++;
      else if (session.status === 'initializing') initializing++;
    });

    return { total: this.sessions.size, active, pending, initializing };
  }

  getSession(userId) {
    return this.sessions.get(userId);
  }

  async createSession(userId, connectionMethod = 'qr_code', phoneNumber = null) {
    console.log(`Creating ${connectionMethod} session for user ${userId}`);

    if (this.sessions.has(userId)) {
      const existing = this.sessions.get(userId);

      if (existing.client && existing.status === 'connected') {
        return {
          sessionId: userId,
          status: 'connected',
          phoneNumber: existing.phoneNumber
        };
      }

      if (existing.status === 'initializing') {
        throw new Error('Session already initializing. Please wait.');
      }

      if (existing.client) {
        try {
          await existing.client.destroy();
        } catch (e) {
          console.log('Error destroying existing client:', e.message);
        }
      }
    }

    const sessionData = {
      client: null,
      qrCode: null,
      pairingCode: null,
      status: 'initializing',
      phoneNumber: null,
      connectionMethod,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    };

    this.sessions.set(userId, sessionData);

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: userId,
        dataPath: '/tmp/whatsapp-sessions'
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-software-rasterizer'
        ],
        timeout: 120000
      }
    });

    sessionData.client = client;

    return new Promise((resolve, reject) => {
      let qrGenerated = false;
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Session initialization timeout'));
        }
      }, 60000);

      client.on('qr', async (qr) => {
        console.log(`QR Code generated for user ${userId}`);

        if (connectionMethod === 'qr_code' && !qrGenerated) {
          try {
            const qrDataUrl = await QRCode.toDataURL(qr, {
              errorCorrectionLevel: 'M',
              margin: 2,
              width: 256
            });

            sessionData.qrCode = qrDataUrl;
            sessionData.status = 'qr_pending';
            sessionData.lastActivity = new Date().toISOString();
            qrGenerated = true;

            await WebhookService.notifySupabase(userId, 'qr_pending', null, qrDataUrl, null);

            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve({
                sessionId: userId,
                qrCode: qrDataUrl,
                status: 'qr_pending',
                method: connectionMethod
              });
            }
          } catch (err) {
            console.error('QR generation error:', err);
          }
        }
      });

      client.on('ready', async () => {
        console.log(`Client ready for user ${userId}`);
        sessionData.status = 'connected';
        sessionData.lastActivity = new Date().toISOString();

        try {
          const info = client.info;
          sessionData.phoneNumber = info?.wid?.user || null;
          console.log(`Connected phone: ${sessionData.phoneNumber}`);
        } catch (e) {
          console.log('Could not get phone info:', e.message);
        }

        await WebhookService.notifySupabase(userId, 'connected', sessionData.phoneNumber, null, null);
      });

      client.on('authenticated', () => {
        console.log(`Client authenticated for user ${userId}`);
        sessionData.lastActivity = new Date().toISOString();
      });

      client.on('auth_failure', async (msg) => {
        console.error(`Auth failure for user ${userId}:`, msg);
        sessionData.status = 'disconnected';
        this.sessions.delete(userId);
        await WebhookService.notifySupabase(userId, 'disconnected', null, null, null);

        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`Authentication failed: ${msg}`));
        }
      });

      client.on('disconnected', async (reason) => {
        console.log(`Client disconnected for user ${userId}:`, reason);
        sessionData.status = 'disconnected';
        this.sessions.delete(userId);
        await WebhookService.notifySupabase(userId, 'disconnected', null, null, null);
      });

      client.on('message', async (message) => {
        sessionData.lastActivity = new Date().toISOString();

        await WebhookService.sendWebhook('message_received', userId, {
          from: message.from,
          fromName: message._data?.notifyName || message.from,
          message: message.body,
          messageId: message.id?._serialized,
          timestamp: message.timestamp
        });
      });

      client.initialize().then(async () => {
        if (connectionMethod === 'pairing_code') {
          if (!phoneNumber) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              this.sessions.delete(userId);
              reject(new Error('Phone number is required for pairing code method'));
            }
            return;
          }

          try {
            console.log(`Requesting pairing code for ${phoneNumber}`);
            const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
            const pairingCode = await client.requestPairingCode(cleanPhone);
            console.log(`Pairing code generated for user ${userId}: ${pairingCode}`);

            sessionData.pairingCode = pairingCode;
            sessionData.status = 'pairing_pending';
            sessionData.phoneNumber = cleanPhone;
            sessionData.lastActivity = new Date().toISOString();

            await WebhookService.notifySupabase(userId, 'pairing_pending', null, null, pairingCode);

            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve({
                sessionId: userId,
                pairingCode,
                status: 'pairing_pending',
                method: connectionMethod
              });
            }
          } catch (error) {
            console.error('Pairing code error:', error);
            this.sessions.delete(userId);

            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              reject(new Error(`Failed to generate pairing code: ${error.message}`));
            }
          }
        }
      }).catch(err => {
        console.error('Client initialization error:', err);
        this.sessions.delete(userId);

        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  async getStatus(userId) {
    const session = this.sessions.get(userId);

    if (!session) {
      return {
        status: 'disconnected',
        connected: false
      };
    }

    let state = null;
    try {
      if (session.client) {
        state = await session.client.getState();
      }
    } catch (e) {
      console.log('Could not get client state:', e.message);
    }

    const isConnected = state === 'CONNECTED' || session.status === 'connected';

    return {
      status: session.status,
      connected: isConnected,
      qrCode: session.qrCode,
      pairingCode: session.pairingCode,
      phoneNumber: session.phoneNumber,
      lastActivity: session.lastActivity
    };
  }

  async sendMessage(userId, to, message, mediaUrl = null) {
    const session = this.sessions.get(userId);

    if (!session || session.status !== 'connected') {
      throw new Error('Session not connected');
    }

    const chatId = to.includes('@c.us') ? to : `${to.replace(/[^0-9]/g, '')}@c.us`;

    try {
      let sentMessage;
      if (mediaUrl) {
        const { MessageMedia } = require('whatsapp-web.js');
        const media = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true });
        sentMessage = await session.client.sendMessage(chatId, media, { caption: message });
      } else {
        sentMessage = await session.client.sendMessage(chatId, message);
      }

      session.lastActivity = new Date().toISOString();

      return {
        success: true,
        whatsappMessageId: sentMessage.id?._serialized
      };
    } catch (error) {
      console.error('Send message error:', error);
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  async disconnectSession(userId) {
    const session = this.sessions.get(userId);

    if (session?.client) {
      try {
        await session.client.logout();
      } catch (e) {
        console.log('Logout error:', e.message);
      }

      try {
        await session.client.destroy();
      } catch (e) {
        console.log('Destroy error:', e.message);
      }
    }

    this.sessions.delete(userId);
    await WebhookService.notifySupabase(userId, 'disconnected', null, null, null);
  }

  async cleanupStaleSessions() {
    const now = Date.now();
    const cleaned = [];

    for (const [userId, session] of this.sessions.entries()) {
      const lastActivity = new Date(session.lastActivity).getTime();
      const age = now - lastActivity;

      const isStale = (
        (session.status === 'qr_pending' && age > QR_TIMEOUT) ||
        (session.status === 'pairing_pending' && age > QR_TIMEOUT) ||
        (session.status === 'initializing' && age > QR_TIMEOUT) ||
        (session.status === 'disconnected' && age > 60000)
      );

      if (isStale) {
        console.log(`Cleaning up stale session: ${userId} (status: ${session.status})`);
        await this.disconnectSession(userId);
        cleaned.push(userId);
      }
    }

    return cleaned;
  }

  async cleanupAll() {
    for (const [userId] of this.sessions.entries()) {
      await this.disconnectSession(userId);
    }
  }
}

module.exports = new SessionManager();
