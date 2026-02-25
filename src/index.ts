import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';

import { router } from './routes';
import { errorMiddleware } from './middleware/error.middleware';
import { logger } from './utils/logger';
import { rabbitmq } from './utils/rabbitmq';

const app = express();
const PORT = process.env.PORT || 3004;

// Ensure uploads directory exists
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Middlewares
app.use(helmet());

const corsOrigins = process.env.CORS_ORIGINS;
app.use(cors({
  origin: corsOrigins ? corsOrigins.split(',').map((o) => o.trim()) : true,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(path.resolve(uploadDir)));

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'konitys-api-clients',
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.use('/api/clients', router);

// 404
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
  });
});

// Global error handler
app.use(errorMiddleware);

const server = createServer(app);

server.listen(PORT, async () => {
  logger.info(`API Clients running on http://localhost:${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`API endpoint: http://localhost:${PORT}/api/clients`);
  await rabbitmq.connect();
});

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down gracefully...');
  await rabbitmq.close();
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
