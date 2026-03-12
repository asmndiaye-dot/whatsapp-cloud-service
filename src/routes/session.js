const express = require('express');
const SessionManager = require('../services/SessionManager');

const router = express.Router();

router.post('/create', async (req, res) => {
  try {
    const { userId, connectionMethod = 'qr_code', phoneNumber } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    console.log(`POST /session/create - userId: ${userId}, method: ${connectionMethod}`);

    const result = await SessionManager.createSession(userId, connectionMethod, phoneNumber);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error creating session:', error);

    if (error.message.includes('initializing') || error.message.includes('wait')) {
      return res.status(409).json({
        error: 'Session in progress',
        message: error.message
      });
    }

    res.status(500).json({
      error: 'Failed to create session',
      message: error.message
    });
  }
});

router.get('/status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    console.log(`GET /session/status/${userId}`);

    const status = await SessionManager.getStatus(userId);

    res.json(status);
  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({
      error: 'Failed to get status',
      message: error.message
    });
  }
});

router.post('/disconnect', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    console.log(`POST /session/disconnect - userId: ${userId}`);

    await SessionManager.disconnectSession(userId);

    res.json({
      success: true,
      message: 'Session disconnected successfully'
    });
  } catch (error) {
    console.error('Error disconnecting session:', error);
    res.status(500).json({
      error: 'Failed to disconnect',
      message: error.message
    });
  }
});

router.delete('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    console.log(`DELETE /session/${userId}`);

    await SessionManager.disconnectSession(userId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error destroying session:', error);
    res.status(500).json({
      error: 'Failed to destroy session',
      message: error.message
    });
  }
});

module.exports = router;
