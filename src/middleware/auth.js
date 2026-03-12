const authMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.headers['x-api-secret'];

  if (!apiKey || apiKey !== process.env.API_SECRET) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing API key'
    });
  }

  next();
};

module.exports = authMiddleware;}