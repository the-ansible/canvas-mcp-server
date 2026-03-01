/**
 * WebSocket client helper for the Canvas MCP Server.
 *
 * Provides a promise-based interface to wait for canvas events via WebSocket,
 * replacing the previous HTTP polling approach.
 */

import WebSocket from 'ws';

export interface WaitForCanvasEventOptions {
  /** Canvas ID to subscribe to */
  canvasId: string;
  /** Only match events from this component (optional) */
  componentId?: string;
  /** Only match this event type (optional) */
  eventType?: string;
  /** Max milliseconds to wait (default: 300000 = 5 minutes) */
  timeoutMs?: number;
  /** WebSocket URL (default: ws://localhost:3001) */
  wsUrl?: string;
}

export interface EventMatch {
  eventId: string;
  eventType: string;
  componentId?: string;
  value?: unknown;
  payload?: object;
  canvasId: string;
}

/**
 * Opens a WebSocket connection, subscribes to a canvas, and waits for a
 * matching `canvas_updated` event containing an action event.
 *
 * Returns the matched event data, or `null` on timeout/error.
 * The connection is created and disposed within the Promise lifecycle.
 */
export function waitForCanvasEvent(
  options: WaitForCanvasEventOptions
): Promise<EventMatch | null> {
  const {
    canvasId,
    componentId,
    eventType,
    timeoutMs = 300_000,
    wsUrl = 'ws://localhost:3001',
  } = options;

  return new Promise<EventMatch | null>((resolve) => {
    let resolved = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try {
        if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
          ws.close();
        }
      } catch {
        // ignore close errors
      }
    };

    const done = (result: EventMatch | null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    try {
      ws = new WebSocket(wsUrl);
    } catch {
      resolve(null);
      return;
    }

    // Timeout
    timer = setTimeout(() => done(null), timeoutMs);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe', canvasId }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;

        if (msg.type === 'canvas_updated' && msg.canvasId === canvasId) {
          const msgData = msg.data as Record<string, unknown> | undefined;
          if (!msgData) return;

          // We're looking for action events (have an `event` field with id and event_type)
          const event = msgData.event as Record<string, unknown> | undefined;
          if (!event || !event.id || !event.event_type) return;

          const eType = event.event_type as string;
          const eComponentId = msgData.componentId as string | undefined;

          // Apply filters
          if (eventType && eType !== eventType) return;
          if (componentId && eComponentId !== componentId) return;

          done({
            eventId: event.id as string,
            eventType: eType,
            componentId: eComponentId,
            value: msgData.value,
            payload: event.payload as object | undefined,
            canvasId,
          });
        }
      } catch {
        // Ignore parse errors
      }
    });

    ws.on('error', () => done(null));
    ws.on('close', () => {
      // If we haven't resolved yet, the connection dropped unexpectedly
      if (!resolved) done(null);
    });
  });
}
