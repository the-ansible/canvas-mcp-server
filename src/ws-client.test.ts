import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import { waitForCanvasEvent } from './ws-client.js';
import type { EventMatch } from './ws-client.js';

// Helper to create a local WebSocket server for testing
function createTestServer(port: number): {
  wss: WebSocketServer;
  close: () => Promise<void>;
  clients: Set<WsWebSocket>;
  broadcast: (msg: object) => void;
  lastMessage: () => Record<string, unknown> | null;
} {
  const wss = new WebSocketServer({ port });
  const clients = new Set<WsWebSocket>();
  let _lastMessage: Record<string, unknown> | null = null;

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('message', (data) => {
      _lastMessage = JSON.parse(data.toString());
      // Auto-send subscribed confirmation
      const msg = _lastMessage!;
      if (msg.type === 'subscribe') {
        ws.send(JSON.stringify({ type: 'subscribed', canvasId: msg.canvasId }));
      }
    });
    ws.on('close', () => clients.delete(ws));
  });

  return {
    wss,
    clients,
    broadcast: (msg: object) => {
      const payload = JSON.stringify(msg);
      for (const ws of clients) {
        if (ws.readyState === WsWebSocket.OPEN) ws.send(payload);
      }
    },
    lastMessage: () => _lastMessage,
    close: () => new Promise<void>((resolve, reject) => {
      for (const ws of clients) ws.close();
      wss.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

describe('waitForCanvasEvent', () => {
  let server: Awaited<ReturnType<typeof createTestServer>> | null = null;
  const TEST_PORT = 19876;
  const WS_URL = `ws://localhost:${TEST_PORT}`;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('resolves on matching canvas_updated event', async () => {
    server = createTestServer(TEST_PORT);

    const promise = waitForCanvasEvent({
      canvasId: 'test-canvas-1',
      wsUrl: WS_URL,
      timeoutMs: 5000,
    });

    // Wait for connection
    await new Promise((r) => setTimeout(r, 100));

    // Broadcast a canvas_updated with an action event
    server.broadcast({
      type: 'canvas_updated',
      canvasId: 'test-canvas-1',
      data: {
        event: {
          id: 'evt-123',
          event_type: 'submit',
          payload: { componentId: 'form-1', value: { name: 'test' } },
          created_at: '2026-01-01T00:00:00Z',
        },
        componentId: 'form-1',
        value: { name: 'test' },
      },
    });

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('evt-123');
    expect(result!.eventType).toBe('submit');
    expect(result!.componentId).toBe('form-1');
    expect(result!.value).toEqual({ name: 'test' });
    expect(result!.canvasId).toBe('test-canvas-1');
  });

  it('filters by eventType', async () => {
    server = createTestServer(TEST_PORT);

    const promise = waitForCanvasEvent({
      canvasId: 'test-canvas-2',
      eventType: 'submit',
      wsUrl: WS_URL,
      timeoutMs: 5000,
    });

    await new Promise((r) => setTimeout(r, 100));

    // Send a click event (should be ignored)
    server.broadcast({
      type: 'canvas_updated',
      canvasId: 'test-canvas-2',
      data: {
        event: { id: 'evt-click', event_type: 'click', payload: {} },
        componentId: 'btn-1',
      },
    });

    // Send a submit event (should match)
    server.broadcast({
      type: 'canvas_updated',
      canvasId: 'test-canvas-2',
      data: {
        event: { id: 'evt-submit', event_type: 'submit', payload: {} },
        componentId: 'form-1',
        value: 'submitted',
      },
    });

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('evt-submit');
    expect(result!.eventType).toBe('submit');
  });

  it('filters by componentId', async () => {
    server = createTestServer(TEST_PORT);

    const promise = waitForCanvasEvent({
      canvasId: 'test-canvas-3',
      componentId: 'form-2',
      wsUrl: WS_URL,
      timeoutMs: 5000,
    });

    await new Promise((r) => setTimeout(r, 100));

    // Send event for wrong componentId
    server.broadcast({
      type: 'canvas_updated',
      canvasId: 'test-canvas-3',
      data: {
        event: { id: 'evt-wrong', event_type: 'submit', payload: {} },
        componentId: 'form-1',
      },
    });

    // Send event for correct componentId
    server.broadcast({
      type: 'canvas_updated',
      canvasId: 'test-canvas-3',
      data: {
        event: { id: 'evt-right', event_type: 'submit', payload: {} },
        componentId: 'form-2',
      },
    });

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('evt-right');
    expect(result!.componentId).toBe('form-2');
  });

  it('returns null on timeout', async () => {
    server = createTestServer(TEST_PORT);

    const result = await waitForCanvasEvent({
      canvasId: 'test-canvas-timeout',
      wsUrl: WS_URL,
      timeoutMs: 200,
    });

    expect(result).toBeNull();
  });

  it('returns null on connection error', async () => {
    // No server running on this port
    const result = await waitForCanvasEvent({
      canvasId: 'test-canvas-err',
      wsUrl: 'ws://localhost:19999',
      timeoutMs: 2000,
    });

    expect(result).toBeNull();
  });

  it('ignores non-action canvas updates (no event field)', async () => {
    server = createTestServer(TEST_PORT);

    const promise = waitForCanvasEvent({
      canvasId: 'test-canvas-4',
      wsUrl: WS_URL,
      timeoutMs: 1000,
    });

    await new Promise((r) => setTimeout(r, 100));

    // Broadcast a canvas CRUD update (no event field — just canvas data)
    server.broadcast({
      type: 'canvas_updated',
      canvasId: 'test-canvas-4',
      data: {
        id: 'test-canvas-4',
        title: 'Updated Title',
        descriptor: {},
      },
    });

    // Should timeout since the update wasn't an action event
    const result = await promise;
    expect(result).toBeNull();
  });

  it('ignores events for different canvasId', async () => {
    server = createTestServer(TEST_PORT);

    const promise = waitForCanvasEvent({
      canvasId: 'test-canvas-5',
      wsUrl: WS_URL,
      timeoutMs: 1000,
    });

    await new Promise((r) => setTimeout(r, 100));

    // Broadcast event for a different canvas
    server.broadcast({
      type: 'canvas_updated',
      canvasId: 'different-canvas',
      data: {
        event: { id: 'evt-other', event_type: 'submit', payload: {} },
        componentId: 'form-1',
      },
    });

    const result = await promise;
    expect(result).toBeNull();
  });

  it('sends subscribe message on connect', async () => {
    server = createTestServer(TEST_PORT);

    const promise = waitForCanvasEvent({
      canvasId: 'test-subscribe',
      wsUrl: WS_URL,
      timeoutMs: 500,
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(server.lastMessage()).toEqual({ type: 'subscribe', canvasId: 'test-subscribe' });

    await promise; // let it timeout
  });
});
