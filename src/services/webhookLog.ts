export interface WebhookDeliveryLog {
  id: string;
  sessionId: string;
  event: string;
  webhookUrl: string;
  status: "success" | "http-error" | "network-error" | "test-success" | "test-fail" | "skipped";
  attempt: number;
  httpStatus?: number;
  latencyMs?: number;
  error?: string;
  timestamp: number;
}

const MAX_LOGS = 500;
const logs: WebhookDeliveryLog[] = [];

export function addWebhookLog(
  entry: Omit<WebhookDeliveryLog, "id" | "timestamp">,
): WebhookDeliveryLog {
  const item: WebhookDeliveryLog = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    ...entry,
  };
  logs.unshift(item);
  if (logs.length > MAX_LOGS) {
    logs.length = MAX_LOGS;
  }
  return item;
}

export function getWebhookLogs(limit = 100, sessionId?: string): WebhookDeliveryLog[] {
  const safeLimit = Math.min(Math.max(limit, 1), MAX_LOGS);
  const filtered = sessionId ? logs.filter((l) => l.sessionId === sessionId) : logs;
  return filtered.slice(0, safeLimit);
}

export function clearWebhookLogs(): void {
  logs.length = 0;
}
