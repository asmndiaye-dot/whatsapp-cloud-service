const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const sessionRoutes = require('./routes/session');
const messageRoutes = require('./routes/message');
const authMiddleware = require('./middleware/auth');
const SessionManager = require('./services/SessionManager');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-API-Secret']
}));
app.use(express.json());

app.get('/health', (req, res) => {
      const stats = SessionManager.getStats();
      res.json({
              status: 'ok',
              timestamp: new Date().toISOString(),
              uptime: process.uptime(),
              memory: process.memoryUsage(),
              sessions: stats
      });
});

app.use('/session', authMiddleware, sessionRoutes);
app.use('/message', authMiddleware, messageRoutes);

app.use((err, req, res, next) => {
      console.error('Unhandled error:', err);
      res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
      console.log(`WhatsApp Cloud Service running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
});
