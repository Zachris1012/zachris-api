'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const apiRoutes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const { startCleanup } = require('./services/cleanup.service');

if (!process.env.API_KEY) {
  console.error('[FATAL] API_KEY belum diset di file .env');
  process.exit(1);
}

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'connect-src': ["'self'"],
        'upgrade-insecure-requests': null, // supaya jalan di http://localhost
      },
    },
  })
);
app.use(cors());
app.use(morgan('tiny'));
app.use(express.json({ limit: '1mb' }));

// Rate limit dasar agar HP tidak kewalahan
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Terlalu banyak request, coba lagi nanti.' },
  })
);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint tidak ditemukan.' });
});

app.use(errorHandler);

const server = app.listen(PORT, HOST, () => {
  console.log(`[OK] Server berjalan di http://${HOST}:${PORT}`);
  startCleanup();
});

// Shutdown rapi saat Ctrl+C / Termux ditutup
const shutdown = (signal) => {
  console.log(`\n[${signal}] Menutup server...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));