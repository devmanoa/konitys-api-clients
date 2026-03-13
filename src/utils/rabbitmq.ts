import amqp from 'amqplib';
import { logger } from './logger';

const RABBITMQ_URL = process.env.RABBITMQ_URL || '';
const RABBITMQ_HTTP_URL = process.env.RABBITMQ_HTTP_URL || ''; // e.g. http://rabbitmq:15672
const RABBITMQ_VHOST = process.env.RABBITMQ_VHOST || '/';
const RABBITMQ_USER = process.env.RABBITMQ_USER || 'guest';
const RABBITMQ_PASS = process.env.RABBITMQ_PASS || 'guest';
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'konitysevents';
const APP_NAME = process.env.APP_NAME || 'unknown';

let connection: amqp.ChannelModel | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

async function connect(): Promise<void> {
  if (!RABBITMQ_URL) {
    logger.warn('[RabbitMQ] RABBITMQ_URL not set — skipping connection');
    return;
  }

  try {
    connection = await amqp.connect(RABBITMQ_URL);
    // Assert exchange once on connect using a temporary channel
    const ch = await connection.createChannel();
    await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
    await ch.close();
    logger.info(`[RabbitMQ] Connected — exchange "${EXCHANGE}" ready`);

    connection.on('error', (err: Error) => {
      logger.error('[RabbitMQ] Connection error:', err.message);
      scheduleReconnect();
    });

    connection.on('close', () => {
      logger.warn('[RabbitMQ] Connection closed');
      connection = null;
      scheduleReconnect();
    });
  } catch (err: any) {
    logger.error('[RabbitMQ] Failed to connect:', err.message);
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    logger.info('[RabbitMQ] Attempting reconnect...');
    connect();
  }, 5000);
}

// Publish via RabbitMQ HTTP Management API (bypasses amqplib publish bug on Node 20 + Docker)
async function publishViaHttp(routingKey: string, message: string): Promise<boolean> {
  if (!RABBITMQ_HTTP_URL) return false;

  const vhost = encodeURIComponent(RABBITMQ_VHOST);
  const url = `${RABBITMQ_HTTP_URL}/api/exchanges/${vhost}/${encodeURIComponent(EXCHANGE)}/publish`;
  const auth = Buffer.from(`${RABBITMQ_USER}:${RABBITMQ_PASS}`).toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      properties: { content_type: 'application/json', delivery_mode: 2 },
      routing_key: routingKey,
      payload: message,
      payload_encoding: 'string',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  const result = await res.json() as { routed: boolean };
  return result.routed;
}

async function publish(routingKey: string, payload: Record<string, any>): Promise<void> {
  if (!connection && !RABBITMQ_HTTP_URL) {
    logger.warn(`[RabbitMQ] Not connected — skipping publish: ${routingKey}`);
    return;
  }

  const message = JSON.stringify({
    event: routingKey,
    source: APP_NAME,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  try {
    // Prefer HTTP Management API (reliable on Node 20 + Docker)
    if (RABBITMQ_HTTP_URL) {
      const routed = await publishViaHttp(routingKey, message);
      logger.info(`[RabbitMQ] Published via HTTP: ${routingKey} (routed: ${routed})`);
      return;
    }

    // Fallback: amqplib (may silently fail on Node 20 + Docker bridge)
    if (connection) {
      const ch = await connection.createChannel();
      ch.publish(EXCHANGE, routingKey, Buffer.from(message), {
        contentType: 'application/json',
        persistent: true,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      await ch.close();
      logger.info(`[RabbitMQ] Published via AMQP: ${routingKey}`);
    }
  } catch (err: any) {
    logger.error(`[RabbitMQ] Publish failed (${routingKey}):`, err.message);
  }
}

async function close(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try {
    if (connection) await connection.close();
  } catch {
    // ignore close errors during shutdown
  }
  connection = null;
  logger.info('[RabbitMQ] Disconnected');
}

export const rabbitmq = { connect, publish, close };
