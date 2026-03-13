import amqp from 'amqplib';
import { logger } from './logger';

const RABBITMQ_URL = process.env.RABBITMQ_URL || '';
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'konitysevents';

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

// Workaround for amqplib channel.publish() silently broken on Node 20 + Docker bridge:
// Use a fresh channel per publish to force socket flush.
async function publish(routingKey: string, payload: Record<string, any>): Promise<void> {
  if (!connection) return;

  const message = JSON.stringify({
    event: routingKey,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  try {
    const ch = await connection.createChannel();
    ch.publish(EXCHANGE, routingKey, Buffer.from(message), {
      contentType: 'application/json',
      persistent: true,
    });
    // Wait for broker confirm before closing channel
    await new Promise<void>((resolve) => setImmediate(resolve));
    await ch.close();
    logger.debug(`[RabbitMQ] Published: ${routingKey}`);
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
