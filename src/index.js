const express = require('express');
const cors = require('cors');
require('dotenv').config();

const sessionRoutes = require('./routes/session');
const messageRoutes = require('./routes/message');
const authMiddleware = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/session', authMiddleware, sessionRoutes);
app.use('/message', authMiddleware, messageRoutes);

app.listen(PORT, () => {
    console.log(`WhatsApp Cloud Service running on port ${PORT}`);
});
