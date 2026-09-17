const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const authRoutes = require('./routes/auth.routes');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.clientOrigin,
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please try again later.',
    },
  },
});

app.use('/api/v1/auth', authLimiter);
app.use('/api/v1/auth', authRoutes);

app.get('/health', (req, res) => {
  res.json({ success: true, message: 'Backend is healthy.' });
});

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
