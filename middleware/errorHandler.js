// middleware/errorHandler.js
function errorHandler(err, req, res, next) {
  const status = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  console.error(`[Error] ${status}: ${message}`);
  res.status(status).json({ error: message });
}

module.exports = errorHandler;
