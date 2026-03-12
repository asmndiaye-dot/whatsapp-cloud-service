const express = require('express');
const SessionManager = require('../services/SessionManager');

const router = express.Router();

router.post('/send', async (req, res) => {
  try {
    const { userId, to, message, mediaUrl } = req.body;

    if (!userId || !to || !message) {
      return res.status(400).json({
        error: 'userId, to, and message are required'
      });
    }

    console.log(`POST /message/send - userId: ${userId}, to: ${to}`);

    const result = await SessionManager.sendMessage(userId, to, message, mediaUrl);

    res.json(result);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      error: 'Failed to send message',
      message: error.message
    });
  }
});

module.exports = router;
