class WebhookService {
    static async sendWebhook(type, userId, data) {
          const webhookUrl = process.env.SUPABASE_WEBHOOK_URL;
          const apiSecret = process.env.API_SECRET;

      if (!webhookUrl) {
              console.error('SUPABASE_WEBHOOK_URL not configured');
              return;
      }

      try {
              const response = await fetch(webhookUrl, {
                        method: 'POST',
                        headers: {
                                    'Content-Type': 'application/json',
                                    'X-API-Secret': apiSecret
                        },
                        body: JSON.stringify({ type, userId, data })
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
