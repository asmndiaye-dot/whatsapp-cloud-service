const authMiddleware = (req, res, next) => {
    const apiSecret = req.headers['x-api-secret'];
    if (!apiSecret || apiSecret !== process.env.API_SECRET) {
          return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

module.exports = authMiddleware;
