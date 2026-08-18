import { registerAs } from '@nestjs/config';

/**
 * Pull-based event listener (Azure Service Bus). It opens an outbound
 * connection only: there is no controller, no route and no inbound port, so
 * nothing is exposed to the public internet.
 */
export default registerAs('eventListener', () => ({
  // Opt-in: while false the listener never connects to Service Bus.
  enabled:
    (process.env.EVENT_LISTENER_ENABLED || 'false').toLowerCase() === 'true',
  // Either a connection string, or a namespace used with managed identity.
  connectionString: process.env.EVENT_LISTENER_CONNECTION_STRING,
  namespace: process.env.EVENT_LISTENER_NAMESPACE,
  // Source: a queue, or a topic + subscription.
  queue: process.env.EVENT_LISTENER_QUEUE,
  topic: process.env.EVENT_LISTENER_TOPIC,
  subscription: process.env.EVENT_LISTENER_SUBSCRIPTION,
  maxConcurrentCalls: parseInt(
    process.env.EVENT_LISTENER_MAX_CONCURRENT || '1',
    10,
  ),
}));
