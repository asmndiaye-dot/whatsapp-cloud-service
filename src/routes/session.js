const express = require('express');
const SessionManager = require('../services/SessionManager');
const router = express.Router();

router.post('/create', async (req, res) => {
    try {
          const { userId } = req.body;
          if (!userId) return res.status(400).json({ error: 'userId is required' });
          const session = await SessionManager.createSession(userId);
          res.json({ success: true, sessionId: userId, qrCode: session.qrCode, status: session.status });
    } catch (error) {
          console.error('Error creating session:', error);
          res.status(500).json({ error: 'Failed to create session' });
    }
});

router.get('/:userId/status', async (req, res) => {
    try {
          const { userId } = req.params;
          const session = SessionManager.getSession(userId);
          if (!session) return res.json({ status: 'disconnected' });
          res.json({ status: session.status, qrCode: session.qrCode });
    } catch (error) {
          res.status(500).json({ error: 'Failed to get status' });
    }
});

router.delete('/:userId', async (req, res) => {
    try {
          const { userId } = req.params;
          await SessionManager.destroySession(userId);
          res.json({ success: true });
    } catch (error) {
          res.status(500).json({ error: 'Failed to destroy session' });
    }
});

module.exports = router;
