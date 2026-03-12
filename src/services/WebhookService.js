class WebhookService {
  static async notifySupabase(userId, status, phoneNumber, qrCode, pairingCode) {
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !supabaseKey) {
        console.warn('Supabase credentials not configured, skipping notification');
        return;
      }

      const updateData = {
        session_status: status,
        last_seen: new Date().toISOString()
      };

      if (phoneNumber) {
        updateData.phone_number = phoneNumber;
      }

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

  static async sendWebhook(type, userId, data) {
    const webhookUrl = process.env.SUPABASE_WEBHOOK_URL;
    const apiSecret = process.env.API_SECRET;

    if (!webhookUrl) {
      return;
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Secret': apiSecret
        },
        body: JSON.stringify({
          type,
          userId,
          data
        })
      });

      if (!response.ok) {
        console.error('Webhook failed:', await response.text());
      }
    } catch (error) {
      console.error('Error sending webhook:', error);
    }
  }
}

module.exports = WebhookService;
