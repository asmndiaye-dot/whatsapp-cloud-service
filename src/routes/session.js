const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const activeSessions = new Map();

const verifyApiSecret = (req, res, next) => {
    const apiSecret = req.headers['x-api-secret'];
    if (!apiSecret || apiSecret !== process.env.API_SECRET) {
          return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// Route principale pour créer une session
app.post('/session/create', verifyApiSecret, async (req, res) => {
    try {
          const { userId, connectionMethod = 'qr_code', phoneNumber } = req.body;

      console.log(`Creating ${connectionMethod} session for user ${userId}`);

      // Vérifier si une session existe déjà
      if (activeSessions.has(userId)) {
              const existingClient = activeSessions.get(userId);

            // Si déjà connecté, retourner l'info
            if (existingClient.info) {
                      return res.json({
                                  sessionId: userId,
                                  status: 'connected',
                                  phoneNumber: existingClient.info.wid.user
                      });
            }

            // Session en cours, rejeter
            return res.status(400).json({
                      error: 'Session already in progress',
                      message: 'Please wait for current session initialization'
            });
      }

      // Créer le client WhatsApp
      const client = new Client({
              authStrategy: new LocalAuth({
                        clientId: userId,
                        dataPath: './sessions'
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
                                    '--disable-gpu'
                                  ]
              }
      });

      // Stocker temporairement
      activeSessions.set(userId, client);

      let responseData = {
              sessionId: userId,
              method: connectionMethod
      };

      let qrGenerated = false;
          let pairingCodeGenerated = false;

      // Handler pour QR Code
      client.on('qr', async (qr) => {
              if (connectionMethod === 'qr_code' && !qrGenerated) {
                        console.log(`QR Code generated for user ${userId}`);
                        try {
                                    const qrDataUrl = await QRCode.toDataURL(qr);
                                    responseData.qrCode = qrDataUrl;
                                    qrGenerated = true;
                                    // Notifier Supabase du QR
                          await notifySupabase(userId, 'qr_pending', null, qrDataUrl, null);
                        } catch (err) {
                                    console.error('QR generation error:', err);
                        }
              }
      });

      // Handler quand le client est prêt
      client.on('ready', async () => {
              console.log(`Client ready for user ${userId}`);
              const phoneNumber = client.info.wid.user;
              console.log(`Connected phone: ${phoneNumber}`);
              // Notifier Supabase de la connexion réussie
                      await notifySupabase(userId, 'connected', phoneNumber, null, null);
      });

      // Handler pour déconnexion
      client.on('disconnected', async (reason) => {
              console.log(`Client disconnected for user ${userId}:`, reason);
              activeSessions.delete(userId);
              await notifySupabase(userId, 'disconnected', null, null, null);
      });

      // Handler pour erreurs d'authentification
      client.on('auth_failure', async (msg) => {
              console.error(`Auth failure for user ${userId}:`, msg);
              activeSessions.delete(userId);
              await notifySupabase(userId, 'disconnected', null, null, null);
      });

      // Initialiser le client
      await client.initialize();

      // Traitement selon la méthode
      if (connectionMethod === 'pairing_code') {
              // PAIRING CODE
            if (!phoneNumber) {
                      client.destroy();
                      activeSessions.delete(userId);
                      return res.status(400).json({
                                  error: 'Phone number required',
                                  message: 'Phone number is required for pairing code method'
                      });
            }

            console.log(`Requesting pairing code for ${phoneNumber}`);

            try {
                      // Demander le pairing code
                const pairingCode = await client.requestPairingCode(phoneNumber);
                      console.log(`Pairing code generated for user ${userId}: ${pairingCode}`);

                responseData.pairingCode = pairingCode;
                      pairingCodeGenerated = true;

                // Notifier Supabase
                await notifySupabase(userId, 'pairing_pending', null, null, pairingCode);

                res.json(responseData);

            } catch (error) {
                      console.error('Pairing code error:', error);
                      client.destroy();
                      activeSessions.delete(userId);
                      return res.status(500).json({
                                  error: 'Failed to generate pairing code',
                                  message: error.message
                      });
            }

      } else {
              // QR CODE
            // Attendre que le QR soit généré
            await new Promise((resolve, reject) => {
                      const timeout = setTimeout(() => {
                                  reject(new Error('QR code generation timeout'));
                      }, 30000); // 30 secondes max

                                      const checkQr = setInterval(() => {
                                                  if (qrGenerated) {
                                                                clearInterval(checkQr);
                                                                clearTimeout(timeout);
                                                                resolve(true);
                                                  }
                                      }, 100);
            });

            res.json(responseData);
      }

    } catch (error) {
          console.error('Session creation error:', error);

      // Nettoyer en cas d'erreur
      if (req.body.userId) {
              const client = activeSessions.get(req.body.userId);
              if (client) {
                        try {
                                    await client.destroy();
                        } catch (e) {
                                    console.error('Error destroying client:', e);
                        }
                        activeSessions.delete(req.body.userId);
              }
      }

      res.status(500).json({
              error: 'Failed to create session',
              message: error.message
      });
    }
});

// Route pour vérifier le statut d'une session
app.get('/session/status/:userId', verifyApiSecret, async (req, res) => {
    try {
          const { userId } = req.params;
          const client = activeSessions.get(userId);

      if (!client) {
              return res.json({
                        status: 'disconnected',
                        connected: false
              });
      }

      const state = await client.getState();
          const isConnected = state === 'CONNECTED';

      res.json({
              status: isConnected ? 'connected' : 'pending',
              connected: isConnected,
              phoneNumber: isConnected ? client.info.wid.user : null
      });

    } catch (error) {
          console.error('Status check error:', error);
          res.status(500).json({
                  error: 'Failed to check status',
                  message: error.message
          });
    }
});

// Route pour envoyer un message
app.post('/message/send', verifyApiSecret, async (req, res) => {
    try {
          const { userId, to, message } = req.body;
          const client = activeSessions.get(userId);

      if (!client) {
              return res.status(404).json({
                        error: 'Session not found',
                        message: 'No active WhatsApp session for this user'
              });
      }

      const chatId = to.includes('@c.us') ? to : `${to}@c.us`;
          await client.sendMessage(chatId, message);

      res.json({
              success: true,
              message: 'Message sent successfully'
      });

    } catch (error) {
          console.error('Send message error:', error);
          res.status(500).json({
                  error: 'Failed to send message',
                  message: error.message
          });
    }
});

// Route pour déconnecter une session
app.post('/session/disconnect', verifyApiSecret, async (req, res) => {
    try {
          const { userId } = req.body;
          const client = activeSessions.get(userId);

      if (!client) {
              return res.json({
                        success: true,
                        message: 'No active session to disconnect'
              });
      }

      await client.destroy();
          activeSessions.delete(userId);
          await notifySupabase(userId, 'disconnected', null, null, null);

      res.json({
              success: true,
              message: 'Session disconnected successfully'
      });

    } catch (error) {
          console.error('Disconnect error:', error);
          res.status(500).json({
                  error: 'Failed to disconnect',
                  message: error.message
          });
    }
});

// Fonction pour notifier Supabase
async function notifySupabase(userId, status, phoneNumber, qrCode, pairingCode) {
    try {
          const supabaseUrl = process.env.SUPABASE_WEBHOOK_URL;
          const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !supabaseKey) {
              console.warn('Supabase credentials not configured, skipping notification');
              return;
      }

      const updateData = {
              session_status: status,
              last_seen: new Date().toISOString()
      };

      if (phoneNumber) updateData.phone_number = phoneNumber;
          if (qrCode) {
                  updateData.qr_code = qrCode;
                  updateData.qr_expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();
          }
          if (pairingCode) {
                  updateData.pairing_code = pairingCode;
                  updateData.pairing_code_expires_at = new Date(Date.now() + 60 * 1000).toISOString();
          }

      const response = await fetch(
              `${supabaseUrl}/rest/v1/whatsapp_sessions?user_id=eq.${userId}`,
        {
                  method: 'PATCH',
                  headers: {
                              'apikey': supabaseKey,
                              'Authorization': `Bearer ${supabaseKey}`,
                              'Content-Type': 'application/json',
                              'Prefer': 'return=minimal'
                  },
                  body: JSON.stringify(updateData)
        }
            );

      if (!response.ok) {
              console.error('Failed to notify Supabase:', await response.text());
      } else {
              console.log(`Supabase notified: ${userId} -> ${status}`);
      }

    } catch (error) {
          console.error('Error notifying Supabase:', error);
    }
}

// Health check
app.get('/health', (req, res) => {
    res.json({
          status: 'ok',
          activeSessions: activeSessions.size,
          uptime: process.uptime()
    });
});

app.listen(PORT, () => {
    console.log(`WhatsApp Cloud Service running on port ${PORT}`);
});
