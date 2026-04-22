import { Redis } from "ioredis";
import { config } from "../config.js";
import { type EventName, type EventPayloadByName } from "./eventTypes.js";

const channel = "future-radius:domain-events";
const pub = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

type AnyHandler = (payload: unknown) => Promise<void> | void;
const handlers = new Map<string, Set<AnyHandler>>();
let sub: Redis | null = null;
let subscribed = false;

async function ensureSubscriber(): Promise<void> {
  if (subscribed) return;
  sub = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  sub.on("message", (incomingChannel, message) => {
    if (incomingChannel !== channel) return;
    try {
      const parsed = JSON.parse(message) as { event: string; payload: unknown };
      const bucket = handlers.get(parsed.event);
      if (!bucket) return;
      for (const handler of bucket) {
        Promise.resolve(handler(parsed.payload)).catch((error) => {
          console.error("event handler failed", parsed.event, error);
        });
      }
    } catch (error) {
      console.error("event bus parse failed", error);
    }
  });
  await sub.subscribe(channel);
  subscribed = true;
}

export async function emitEvent<E extends EventName>(
  event: E,
  payload: EventPayloadByName[E]
): Promise<void> {
  await pub.publish(channel, JSON.stringify({ event, payload, at: new Date().toISOString() }));
}

export async function listenEvent<E extends EventName>(
  event: E,
  handler: (payload: EventPayloadByName[E]) => Promise<void> | void
): Promise<void> {
  await ensureSubscriber();
  const bucket = handlers.get(event) ?? new Set<AnyHandler>();
  bucket.add(handler as AnyHandler);
  handlers.set(event, bucket);
}
