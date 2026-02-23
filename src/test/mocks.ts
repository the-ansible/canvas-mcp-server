import { vi } from 'vitest';

export interface MockFetchOptions {
  status?: number;
  ok?: boolean;
  data?: unknown;
  error?: string;
}

export function createMockResponse(options: MockFetchOptions): Response {
  const { status = 200, ok = true, data = {}, error } = options;

  const response = {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(error || JSON.stringify(data)),
  } as unknown as Response;

  return response;
}

export function mockFetchSuccess(data: unknown): void {
  global.fetch = vi.fn().mockResolvedValue(
    createMockResponse({ data, ok: true, status: 200 })
  );
}

export function mockFetchCreated(data: unknown): void {
  global.fetch = vi.fn().mockResolvedValue(
    createMockResponse({ data, ok: true, status: 201 })
  );
}

export function mockFetchError(status: number, errorMessage: string): void {
  global.fetch = vi.fn().mockResolvedValue(
    createMockResponse({ ok: false, status, error: errorMessage })
  );
}

export function mockFetchConnectionError(): void {
  global.fetch = vi.fn().mockRejectedValue(
    new TypeError('fetch failed: connection refused')
  );
}

export function resetFetchMock(): void {
  vi.restoreAllMocks();
}

// Sample data for testing
export const mockCanvas = {
  id: 'abc-123',
  title: 'Test Canvas',
  descriptor: {
    title: 'Test Canvas',
    components: [
      { id: 'text-1', type: 'text', props: { content: 'Hello' } },
    ],
  },
  state: {},
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

export const mockCanvasSummary = {
  id: 'abc-123',
  title: 'Test Canvas',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

export const mockCanvases = [
  mockCanvasSummary,
  {
    id: 'def-456',
    title: 'Dashboard',
    created_at: '2026-01-02T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
  },
];

export const mockEvent = {
  id: 'evt-1',
  canvas_id: 'abc-123',
  event_type: 'click',
  payload: { componentId: 'btn-1', eventType: 'click' },
  created_at: '2026-01-01T00:00:00.000Z',
};

export const mockEventsResponse = {
  events: [mockEvent],
  total: 1,
  offset: 0,
  limit: 100,
};

export const mockStateSnapshot = {
  canvasId: 'abc-123',
  snapshotAt: '2026-01-01T00:00:00.000Z',
  components: {
    'input-1': { value: 'test' },
  },
  formValidity: { valid: true },
};

export const mockComponentState = {
  state: { value: 'test' },
  updatedAt: '2026-01-01T00:00:00.000Z',
};

export const mockPendingEventsResponse = {
  events: [
    {
      id: 'evt-1',
      canvas_id: 'abc-123',
      event_type: 'click',
      payload: { componentId: 'btn-1', eventType: 'click' },
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'evt-2',
      canvas_id: 'abc-123',
      event_type: 'change',
      payload: { componentId: 'input-1', eventType: 'change', value: 'hello' },
      created_at: '2026-01-01T00:00:01.000Z',
    },
  ],
  total: 2,
};

export const mockAcknowledgeResponse = {
  acknowledged: true,
  eventId: 'evt-1',
};

export const mockBatchAcknowledgeResponse = {
  acknowledged: 2,
  eventIds: ['evt-1', 'evt-2'],
};
