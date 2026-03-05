const express = require('express');
const SessionManager = require('../services/SessionManager');
const router = express.Router();

router.post('/send', async (req, res) => {
    try {
          const { userId, to, message } = req.body;
          if (!userId || !to || !message) {
                  return res.status(400).json({ error: 'userId, to, and message are required' });
          }
          const result = await SessionManager.sendMessage(userId, to, message);
          res.json(result);
    } catch (error) {
          console.error('Error sending message:', error);
          res.status(500).json({ error: 'Failed to send message', message: error.message });
    }
});

module.exports = router;
