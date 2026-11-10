/**
 * Global event bus for forwarding Baileys events to dashboard SSE clients.
 */
import { EventEmitter } from "node:events";

export interface DashboardEvent {
  sessionId: string;
  event: string;
  data: unknown;
  timestamp: number;
}

class EventBus extends EventEmitter {
  private recentEvents: DashboardEvent[] = [];
  private maxRecent = 100;

  emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (eventName === "baileys-event" && args[0]) {
      const ev = args[0] as DashboardEvent;
      ev.timestamp = Date.now();
      this.recentEvents.push(ev);
      if (this.recentEvents.length > this.maxRecent) {
        this.recentEvents = this.recentEvents.slice(-this.maxRecent);
      }
    }
    return super.emit(eventName, ...args);
  }

  getRecentEvents(limit = 50): DashboardEvent[] {
    return this.recentEvents.slice(-limit);
  }

  clearEvents() {
    this.recentEvents = [];
  }
}

const eventBus = new EventBus();
eventBus.setMaxListeners(50);

export default eventBus;
