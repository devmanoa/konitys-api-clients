import amqp from 'amqplib';
import { logger } from './logger';

const RABBITMQ_URL = process.env.RABBITMQ_URL || '';
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'konitysevents';

let connection: amqp.ChannelModel | null = null;
let channel: amqp.Channel | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

async function connect(): Promise<void> {
  if (!RABBITMQ_URL) {
    logger.warn('[RabbitMQ] RABBITMQ_URL not set — skipping connection');
    return;
  }

  try {
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    logger.info(`[RabbitMQ] Connected — exchange "${EXCHANGE}" ready`);

    connection.on('error', (err: Error) => {
      logger.error('[RabbitMQ] Connection error:', err.message);
      scheduleReconnect();
    });

    connection.on('close', () => {
      logger.warn('[RabbitMQ] Connection closed');
      channel = null;
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

function publish(routingKey: string, payload: Record<string, any>): void {
  if (!channel) return;

  const message = JSON.stringify({
    event: routingKey,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  try {
    channel.publish(EXCHANGE, routingKey, Buffer.from(message), {
      contentType: 'application/json',
      persistent: true,
    });
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
    if (channel) await channel.close();
    if (connection) await connection.close();
  } catch {
    // ignore close errors during shutdown
  }
  channel = null;
  connection = null;
  logger.info('[RabbitMQ] Disconnected');
}

export const rabbitmq = { connect, publish, close };
