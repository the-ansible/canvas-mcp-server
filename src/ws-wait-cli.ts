#!/usr/bin/env npx tsx
/**
 * CLI wrapper around waitForCanvasEvent.
 * Opens a WebSocket, subscribes, blocks until a matching event arrives, prints JSON to stdout.
 *
 * Usage:
 *   npx tsx ws-wait-cli.ts <canvasId> [componentId] [timeoutMs]
 *
 * Examples:
 *   npx tsx ws-wait-cli.ts abc123                     # any event, 5min timeout
 *   npx tsx ws-wait-cli.ts abc123 player-move         # only player-move events
 *   npx tsx ws-wait-cli.ts abc123 user-chat 300000    # user-chat, 5min timeout
 *
 * Output: JSON object on stdout, or {"error":"timeout"} / {"error":"..."} on failure.
 */

import { waitForCanvasEvent } from './ws-client.js';

const [canvasId, componentId, timeoutStr] = process.argv.slice(2);

if (!canvasId) {
  console.error('Usage: ws-wait-cli.ts <canvasId> [componentId] [timeoutMs]');
  process.exit(1);
}

const timeoutMs = timeoutStr ? parseInt(timeoutStr, 10) : 300_000; // default 5 min

const result = await waitForCanvasEvent({
  canvasId,
  componentId: componentId || undefined,
  timeoutMs,
  wsUrl: 'ws://localhost:3001',
});

if (result) {
  console.log(JSON.stringify(result));
} else {
  console.log(JSON.stringify({ error: 'timeout' }));
}
