import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mockFetchSuccess,
  mockFetchError,
  mockFetchConnectionError,
  resetFetchMock,
  mockCanvas,
  mockCanvases,
  mockEvent,
  mockEventsResponse,
  mockStateSnapshot,
  mockComponentState,
  mockPendingEventsResponse,
  mockAcknowledgeResponse,
  mockBatchAcknowledgeResponse,
} from './test/mocks.js';
import { handleToolCall } from './index.js';

// Helper to parse the JSON text from a tool result
function parseResult(result: { content: Array<{ type: string; text: string }>; isError?: boolean }) {
  return JSON.parse(result.content[0].text);
}

describe('MCP Tool Handlers', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => resetFetchMock());

  // ========== list_canvases ==========
  describe('list_canvases', () => {
    it('should return all canvases as JSON', async () => {
      mockFetchSuccess(mockCanvases);
      const result = await handleToolCall('list_canvases', {});
      expect(result.isError).toBeUndefined();
      expect(parseResult(result)).toEqual(mockCanvases);
    });

    it('should return empty array when no canvases exist', async () => {
      mockFetchSuccess([]);
      const result = await handleToolCall('list_canvases', {});
      expect(parseResult(result)).toEqual([]);
    });

    it('should return error when API is unreachable', async () => {
      mockFetchConnectionError();
      const result = await handleToolCall('list_canvases', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Cannot connect to Canvas API');
    });
  });

  // ========== create_canvas ==========
  describe('create_canvas', () => {
    it('should create canvas from valid descriptor', async () => {
      mockFetchSuccess(mockCanvas);
      const result = await handleToolCall('create_canvas', {
        descriptor: {
          title: 'Test Canvas',
          components: [{ id: 'text-1', type: 'text', props: { content: 'Hello' } }],
        },
      });
      expect(result.isError).toBeUndefined();
      expect(parseResult(result)).toEqual(mockCanvas);
    });

    it('should reject missing descriptor', async () => {
      const result = await handleToolCall('create_canvas', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required field: descriptor');
    });

    it('should reject descriptor without title', async () => {
      const result = await handleToolCall('create_canvas', {
        descriptor: { components: [] },
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('title');
    });

    it('should reject descriptor without components', async () => {
      const result = await handleToolCall('create_canvas', {
        descriptor: { title: 'Test' },
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('components');
    });

    it('should reject non-object descriptor', async () => {
      const result = await handleToolCall('create_canvas', {
        descriptor: 'not an object',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('must be an object');
    });
  });

  // ========== get_canvas ==========
  describe('get_canvas', () => {
    it('should return canvas by id', async () => {
      mockFetchSuccess(mockCanvas);
      const result = await handleToolCall('get_canvas', { id: 'abc-123' });
      expect(result.isError).toBeUndefined();
      expect(parseResult(result)).toEqual(mockCanvas);
    });

    it('should reject missing id', async () => {
      const result = await handleToolCall('get_canvas', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required field: id');
    });

    it('should reject empty id', async () => {
      const result = await handleToolCall('get_canvas', { id: '' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('cannot be empty');
    });

    it('should propagate 404 errors', async () => {
      mockFetchError(404, 'Canvas not found');
      const result = await handleToolCall('get_canvas', { id: 'nonexistent' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('404');
    });
  });

  // ========== update_canvas ==========
  describe('update_canvas', () => {
    it('should update canvas with descriptor', async () => {
      mockFetchSuccess(mockCanvas);
      const result = await handleToolCall('update_canvas', {
        id: 'abc-123',
        descriptor: { title: 'Updated', components: [] },
      });
      expect(result.isError).toBeUndefined();
    });

    it('should update canvas with state', async () => {
      mockFetchSuccess(mockCanvas);
      const result = await handleToolCall('update_canvas', {
        id: 'abc-123',
        state: { theme: 'dark' },
      });
      expect(result.isError).toBeUndefined();
    });

    it('should update canvas with components', async () => {
      mockFetchSuccess(mockCanvas);
      const result = await handleToolCall('update_canvas', {
        id: 'abc-123',
        components: [{ id: 'input-1', state: { value: 'new' } }],
      });
      expect(result.isError).toBeUndefined();
    });

    it('should reject when no update fields provided', async () => {
      const result = await handleToolCall('update_canvas', { id: 'abc-123' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('At least one field must be provided');
    });

    it('should reject missing id', async () => {
      const result = await handleToolCall('update_canvas', {
        descriptor: { title: 'X', components: [] },
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('id');
    });
  });

  // ========== delete_canvas ==========
  describe('delete_canvas', () => {
    it('should delete canvas by id', async () => {
      mockFetchSuccess({ deleted: true, id: 'abc-123' });
      const result = await handleToolCall('delete_canvas', { id: 'abc-123' });
      expect(result.isError).toBeUndefined();
      expect(parseResult(result)).toEqual({ deleted: true, id: 'abc-123' });
    });

    it('should reject missing id', async () => {
      const result = await handleToolCall('delete_canvas', {});
      expect(result.isError).toBe(true);
    });
  });

  // ========== get_canvas_url ==========
  describe('get_canvas_url', () => {
    it('should return URL for existing canvas', async () => {
      mockFetchSuccess(mockCanvas);
      const result = await handleToolCall('get_canvas_url', { id: 'abc-123' });
      expect(result.isError).toBeUndefined();
      const parsed = parseResult(result);
      expect(parsed.url).toContain('canvasId=abc-123');
      expect(parsed.url).toContain('localhost:3003/apps/canvas-ui');
    });

    it('should propagate 404 for non-existent canvas', async () => {
      mockFetchError(404, 'Canvas not found');
      const result = await handleToolCall('get_canvas_url', { id: 'nonexistent' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('404');
    });

    it('should reject missing id', async () => {
      const result = await handleToolCall('get_canvas_url', {});
      expect(result.isError).toBe(true);
    });
  });

  // ========== get_canvas_state ==========
  describe('get_canvas_state', () => {
    it('should return full state snapshot', async () => {
      mockFetchSuccess(mockStateSnapshot);
      const result = await handleToolCall('get_canvas_state', { id: 'abc-123' });
      expect(result.isError).toBeUndefined();
      expect(parseResult(result)).toEqual(mockStateSnapshot);
    });

    it('should reject missing id', async () => {
      const result = await handleToolCall('get_canvas_state', {});
      expect(result.isError).toBe(true);
    });
  });

  // ========== get_component_state ==========
  describe('get_component_state', () => {
    it('should return single component state', async () => {
      mockFetchSuccess(mockComponentState);
      const result = await handleToolCall('get_component_state', {
        canvasId: 'abc-123',
        componentId: 'input-1',
      });
      expect(result.isError).toBeUndefined();
      expect(parseResult(result)).toEqual(mockComponentState);
    });

    it('should reject missing canvasId', async () => {
      const result = await handleToolCall('get_component_state', { componentId: 'input-1' });
      expect(result.isError).toBe(true);
    });

    it('should reject missing componentId', async () => {
      const result = await handleToolCall('get_component_state', { canvasId: 'abc-123' });
      expect(result.isError).toBe(true);
    });
  });

  // ========== add_component ==========
  describe('add_component', () => {
    it('should add component to canvas', async () => {
      const mockResult = { added: { id: 'text-2', type: 'text' }, canvas: mockCanvas };
      mockFetchSuccess(mockResult);
      const result = await handleToolCall('add_component', {
        canvasId: 'abc-123',
        component: { id: 'text-2', type: 'text', props: { content: 'New' } },
      });
      expect(result.isError).toBeUndefined();
      expect(parseResult(result)).toEqual(mockResult);
    });

    it('should accept parentId and position', async () => {
      mockFetchSuccess({ added: { id: 'x' }, canvas: mockCanvas });
      const result = await handleToolCall('add_component', {
        canvasId: 'abc-123',
        component: { id: 'x', type: 'input' },
        parentId: 'form-1',
        position: 2,
      });
      expect(result.isError).toBeUndefined();
    });

    it('should reject missing canvasId', async () => {
      const result = await handleToolCall('add_component', {
        component: { id: 'x', type: 'text' },
      });
      expect(result.isError).toBe(true);
    });

    it('should reject missing component', async () => {
      const result = await handleToolCall('add_component', { canvasId: 'abc-123' });
      expect(result.isError).toBe(true);
    });

    it('should reject non-object component', async () => {
      const result = await handleToolCall('add_component', {
        canvasId: 'abc-123',
        component: 'not an object',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('must be an object');
    });
  });

  // ========== update_component ==========
  describe('update_component', () => {
    it('should update component props', async () => {
      mockFetchSuccess({ updated: { id: 'text-1' }, canvas: mockCanvas });
      const result = await handleToolCall('update_component', {
        canvasId: 'abc-123',
        componentId: 'text-1',
        props: { content: 'Updated' },
      });
      expect(result.isError).toBeUndefined();
    });

    it('should update component style', async () => {
      mockFetchSuccess({ updated: { id: 'text-1' }, canvas: mockCanvas });
      const result = await handleToolCall('update_component', {
        canvasId: 'abc-123',
        componentId: 'text-1',
        style: { color: 'red' },
      });
      expect(result.isError).toBeUndefined();
    });

    it('should update component children', async () => {
      mockFetchSuccess({ updated: { id: 'container-1' }, canvas: mockCanvas });
      const result = await handleToolCall('update_component', {
        canvasId: 'abc-123',
        componentId: 'container-1',
        children: [{ id: 'child-1', type: 'text', props: { content: 'X' } }],
      });
      expect(result.isError).toBeUndefined();
    });

    it('should reject when no update fields provided', async () => {
      const result = await handleToolCall('update_component', {
        canvasId: 'abc-123',
        componentId: 'text-1',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('At least one field must be provided');
    });

    it('should reject missing canvasId', async () => {
      const result = await handleToolCall('update_component', {
        componentId: 'text-1',
        props: { content: 'X' },
      });
      expect(result.isError).toBe(true);
    });

    it('should reject missing componentId', async () => {
      const result = await handleToolCall('update_component', {
        canvasId: 'abc-123',
        props: { content: 'X' },
      });
      expect(result.isError).toBe(true);
    });
  });

  // ========== remove_component ==========
  describe('remove_component', () => {
    it('should remove component from canvas', async () => {
      const mockResult = { removed: { id: 'text-1' }, canvas: mockCanvas };
      mockFetchSuccess(mockResult);
      const result = await handleToolCall('remove_component', {
        canvasId: 'abc-123',
        componentId: 'text-1',
      });
      expect(result.isError).toBeUndefined();
      expect(parseResult(result)).toEqual(mockResult);
    });

    it('should reject missing canvasId', async () => {
      const result = await handleToolCall('remove_component', { componentId: 'text-1' });
      expect(result.isError).toBe(true);
    });

    it('should reject missing componentId', async () => {
      const result = await handleToolCall('remove_component', { canvasId: 'abc-123' });
      expect(result.isError).toBe(true);
    });
  });

  // ========== post_action ==========
  describe('post_action', () => {
    it('should post action event', async () => {
      mockFetchSuccess(mockEvent);
      const result = await handleToolCall('post_action', {
        canvasId: 'abc-123',
        componentId: 'btn-1',
        eventType: 'click',
      });
      expect(result.isError).toBeUndefined();
      expect(parseResult(result)).toEqual(mockEvent);
    });

    it('should include optional value and metadata', async () => {
      mockFetchSuccess(mockEvent);
      const result = await handleToolCall('post_action', {
        canvasId: 'abc-123',
        componentId: 'input-1',
        eventType: 'change',
        value: 'hello',
        metadata: { source: 'keyboard' },
      });
      expect(result.isError).toBeUndefined();
      // Verify correct body was sent
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.value).toBe('hello');
      expect(body.metadata).toEqual({ source: 'keyboard' });
    });

    it('should reject missing canvasId', async () => {
      const result = await handleToolCall('post_action', {
        componentId: 'btn-1',
        eventType: 'click',
      });
      expect(result.isError).toBe(true);
    });

    it('should reject missing componentId', async () => {
      const result = await handleToolCall('post_action', {
        canvasId: 'abc-123',
        eventType: 'click',
      });
      expect(result.isError).toBe(true);
    });

    it('should reject missing eventType', async () => {
      const result = await handleToolCall('post_action', {
        canvasId: 'abc-123',
        componentId: 'btn-1',
      });
      expect(result.isError).toBe(true);
    });

    it('should reject non-object metadata', async () => {
      const result = await handleToolCall('post_action', {
        canvasId: 'abc-123',
        componentId: 'btn-1',
        eventType: 'click',
        metadata: 'not an object',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('must be an object');
    });
  });

  // ========== get_events ==========
  describe('get_events', () => {
    it('should get events for a canvas', async () => {
      mockFetchSuccess(mockEventsResponse);
      const result = await handleToolCall('get_events', { canvasId: 'abc-123' });
      expect(result.isError).toBeUndefined();
      expect(parseResult(result)).toEqual(mockEventsResponse);
    });

    it('should pass filter parameters', async () => {
      mockFetchSuccess(mockEventsResponse);
      await handleToolCall('get_events', {
        canvasId: 'abc-123',
        componentId: 'btn-1',
        eventType: 'click',
        limit: 50,
        offset: 10,
      });
      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(url).toContain('componentId=btn-1');
      expect(url).toContain('eventType=click');
      expect(url).toContain('limit=50');
      expect(url).toContain('offset=10');
    });

    it('should reject missing canvasId', async () => {
      const result = await handleToolCall('get_events', {});
      expect(result.isError).toBe(true);
    });

    it('should reject non-number limit', async () => {
      const result = await handleToolCall('get_events', {
        canvasId: 'abc-123',
        limit: 'fifty',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('must be a number');
    });
  });

  // ========== get_pending_events ==========
  describe('get_pending_events', () => {
    it('should get pending events', async () => {
      mockFetchSuccess(mockPendingEventsResponse);
      const result = await handleToolCall('get_pending_events', { canvasId: 'abc-123' });
      expect(result.isError).toBeUndefined();
      expect(parseResult(result)).toEqual(mockPendingEventsResponse);
    });

    it('should pass filter parameters', async () => {
      mockFetchSuccess(mockPendingEventsResponse);
      await handleToolCall('get_pending_events', {
        canvasId: 'abc-123',
        componentId: 'btn-1',
        eventType: 'click',
      });
      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(url).toContain('events/pending');
      expect(url).toContain('componentId=btn-1');
      expect(url).toContain('eventType=click');
    });

    it('should reject missing canvasId', async () => {
      const result = await handleToolCall('get_pending_events', {});
      expect(result.isError).toBe(true);
    });
  });

  // ========== acknowledge_event ==========
  describe('acknowledge_event', () => {
    it('should acknowledge single event by eventId', async () => {
      mockFetchSuccess(mockAcknowledgeResponse);
      const result = await handleToolCall('acknowledge_event', {
        canvasId: 'abc-123',
        eventId: 'evt-1',
      });
      expect(result.isError).toBeUndefined();
      expect(parseResult(result)).toEqual(mockAcknowledgeResponse);
    });

    it('should acknowledge batch events by eventIds', async () => {
      mockFetchSuccess(mockBatchAcknowledgeResponse);
      const result = await handleToolCall('acknowledge_event', {
        canvasId: 'abc-123',
        eventIds: ['evt-1', 'evt-2'],
      });
      expect(result.isError).toBeUndefined();
      expect(parseResult(result)).toEqual(mockBatchAcknowledgeResponse);
    });

    it('should reject when neither eventId nor eventIds provided', async () => {
      const result = await handleToolCall('acknowledge_event', { canvasId: 'abc-123' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Either eventId or eventIds must be provided');
    });

    it('should reject when both eventId and eventIds provided', async () => {
      const result = await handleToolCall('acknowledge_event', {
        canvasId: 'abc-123',
        eventId: 'evt-1',
        eventIds: ['evt-1'],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not both');
    });

    it('should reject missing canvasId', async () => {
      const result = await handleToolCall('acknowledge_event', { eventId: 'evt-1' });
      expect(result.isError).toBe(true);
    });

    it('should propagate 404 for non-existent event', async () => {
      mockFetchError(404, 'Event not found');
      const result = await handleToolCall('acknowledge_event', {
        canvasId: 'abc-123',
        eventId: 'nonexistent',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('404');
    });
  });

  // ========== subscribe_to_events ==========
  describe('subscribe_to_events', () => {
    it('should return all pending events with no filters', async () => {
      mockFetchSuccess(mockPendingEventsResponse);
      const result = await handleToolCall('subscribe_to_events', { canvasId: 'abc-123' });
      expect(result.isError).toBeUndefined();
      const parsed = parseResult(result);
      expect(parsed.events).toHaveLength(2);
      expect(parsed.total).toBe(2);
      expect(parsed.filters.componentIds).toEqual([]);
      expect(parsed.filters.eventTypes).toEqual([]);
    });

    it('should filter by componentIds', async () => {
      const filtered = { events: [mockPendingEventsResponse.events[0]], total: 1 };
      mockFetchSuccess(filtered);
      const result = await handleToolCall('subscribe_to_events', {
        canvasId: 'abc-123',
        componentIds: ['btn-1'],
      });
      expect(result.isError).toBeUndefined();
      const parsed = parseResult(result);
      expect(parsed.filters.componentIds).toEqual(['btn-1']);
    });

    it('should filter by eventTypes', async () => {
      const filtered = { events: [mockPendingEventsResponse.events[1]], total: 1 };
      mockFetchSuccess(filtered);
      const result = await handleToolCall('subscribe_to_events', {
        canvasId: 'abc-123',
        eventTypes: ['change'],
      });
      expect(result.isError).toBeUndefined();
      const parsed = parseResult(result);
      expect(parsed.filters.eventTypes).toEqual(['change']);
    });

    it('should reject missing canvasId', async () => {
      const result = await handleToolCall('subscribe_to_events', {});
      expect(result.isError).toBe(true);
    });
  });

  // ========== show_chart ==========
  describe('show_chart', () => {
    it('should create chart canvas and return URL', async () => {
      mockFetchSuccess({ ...mockCanvas, id: 'chart-1' });
      const result = await handleToolCall('show_chart', {
        title: 'Revenue',
        chartType: 'line',
        labels: ['Jan', 'Feb', 'Mar'],
        datasets: [{ label: 'Revenue', data: [100, 200, 300] }],
      });
      expect(result.isError).toBeUndefined();
      const parsed = parseResult(result);
      expect(parsed.url).toContain('canvasId=chart-1');
      expect(parsed.title).toBe('Test Canvas');
    });

    it('should pass custom height and options', async () => {
      mockFetchSuccess(mockCanvas);
      await handleToolCall('show_chart', {
        title: 'Custom',
        chartType: 'bar',
        labels: ['A'],
        datasets: [{ label: 'D', data: [1] }],
        height: '600px',
        options: { responsive: true },
      });
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body);
      const chart = body.components[0].children[1];
      expect(chart.props.height).toBe('600px');
      expect(chart.props.options).toEqual({ responsive: true });
    });

    it('should reject missing title', async () => {
      const result = await handleToolCall('show_chart', {
        chartType: 'line',
        labels: [],
        datasets: [],
      });
      expect(result.isError).toBe(true);
    });

    it('should reject missing datasets', async () => {
      const result = await handleToolCall('show_chart', {
        title: 'X',
        chartType: 'line',
        labels: [],
      });
      expect(result.isError).toBe(true);
    });

    it('should handle API errors gracefully', async () => {
      mockFetchError(500, 'Internal server error');
      const result = await handleToolCall('show_chart', {
        title: 'X',
        chartType: 'line',
        labels: [],
        datasets: [],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('500');
    });
  });

  // ========== show_table ==========
  describe('show_table', () => {
    it('should create table canvas and return URL', async () => {
      mockFetchSuccess({ ...mockCanvas, id: 'table-1' });
      const result = await handleToolCall('show_table', {
        title: 'Users',
        columns: [{ key: 'name', label: 'Name' }],
        data: [{ name: 'Alice' }],
      });
      expect(result.isError).toBeUndefined();
      const parsed = parseResult(result);
      expect(parsed.url).toContain('canvasId=table-1');
      expect(parsed.rowCount).toBe(1);
      expect(parsed.columnCount).toBe(1);
    });

    it('should set sortable true by default', async () => {
      mockFetchSuccess(mockCanvas);
      await handleToolCall('show_table', {
        title: 'T',
        columns: [{ key: 'x', label: 'X' }],
        data: [],
      });
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body);
      const table = body.components[0].children[1];
      expect(table.props.sortable).toBe(true);
    });

    it('should include pagination when pageSize set', async () => {
      mockFetchSuccess(mockCanvas);
      await handleToolCall('show_table', {
        title: 'T',
        columns: [{ key: 'x', label: 'X' }],
        data: [],
        pageSize: 25,
      });
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body);
      const table = body.components[0].children[1];
      expect(table.props.pagination).toEqual({ pageSize: 25, showPageInfo: true });
    });

    it('should reject missing columns', async () => {
      const result = await handleToolCall('show_table', {
        title: 'T',
        data: [],
      });
      expect(result.isError).toBe(true);
    });

    it('should reject non-boolean sortable', async () => {
      const result = await handleToolCall('show_table', {
        title: 'T',
        columns: [{ key: 'x', label: 'X' }],
        data: [],
        sortable: 'yes' as unknown as boolean,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('boolean');
    });
  });

  // ========== show_form ==========
  describe('show_form', () => {
    it('should create form canvas with fields', async () => {
      mockFetchSuccess({ ...mockCanvas, id: 'form-1' });
      const result = await handleToolCall('show_form', {
        title: 'Contact',
        fields: [
          { name: 'email', label: 'Email', type: 'email', required: true },
          { name: 'message', label: 'Message', type: 'textarea' },
        ],
      });
      expect(result.isError).toBeUndefined();
      const parsed = parseResult(result);
      expect(parsed.fieldCount).toBe(2);
      expect(parsed.note).toContain('get_pending_events');
    });

    it('should build correct descriptor for text input', async () => {
      mockFetchSuccess(mockCanvas);
      await handleToolCall('show_form', {
        title: 'Test',
        fields: [{ name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Enter name' }],
      });
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body);
      const form = body.components[0].children[1]; // heading + form
      const field = form.children[0];
      expect(field.type).toBe('input');
      expect(field.props.inputType).toBe('text');
      expect(field.props.required).toBe(true);
      expect(field.props.placeholder).toBe('Enter name');
    });

    it('should build select fields with options', async () => {
      mockFetchSuccess(mockCanvas);
      await handleToolCall('show_form', {
        title: 'Test',
        fields: [{
          name: 'role',
          label: 'Role',
          type: 'select',
          options: [{ label: 'Admin', value: 'admin' }, { label: 'User', value: 'user' }],
        }],
      });
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body);
      const form = body.components[0].children[1];
      const field = form.children[0];
      expect(field.type).toBe('select');
      expect(field.props.options).toHaveLength(2);
    });

    it('should build checkbox fields', async () => {
      mockFetchSuccess(mockCanvas);
      await handleToolCall('show_form', {
        title: 'Test',
        fields: [{ name: 'agree', label: 'I agree', type: 'checkbox' }],
      });
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body);
      const form = body.components[0].children[1];
      expect(form.children[0].type).toBe('checkbox');
    });

    it('should build radio fields with options', async () => {
      mockFetchSuccess(mockCanvas);
      await handleToolCall('show_form', {
        title: 'Test',
        fields: [{
          name: 'priority',
          label: 'Priority',
          type: 'radio',
          options: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }],
        }],
      });
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body);
      const form = body.components[0].children[1];
      expect(form.children[0].type).toBe('radio');
      expect(form.children[0].props.options).toHaveLength(2);
    });

    it('should use custom submitLabel', async () => {
      mockFetchSuccess(mockCanvas);
      await handleToolCall('show_form', {
        title: 'Test',
        fields: [{ name: 'x', label: 'X', type: 'text' }],
        submitLabel: 'Send Now',
      });
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body);
      const form = body.components[0].children[1];
      const submitBtn = form.children[form.children.length - 1];
      expect(submitBtn.props.label).toBe('Send Now');
    });

    it('should include description when provided', async () => {
      mockFetchSuccess(mockCanvas);
      await handleToolCall('show_form', {
        title: 'Test',
        fields: [{ name: 'x', label: 'X', type: 'text' }],
        description: 'Please fill out this form.',
      });
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body);
      const rootChildren = body.components[0].children;
      // Should have: heading, description text, form
      expect(rootChildren).toHaveLength(3);
      expect(rootChildren[1].id).toBe('form-description');
      expect(rootChildren[1].props.content).toBe('Please fill out this form.');
    });

    it('should reject missing fields', async () => {
      const result = await handleToolCall('show_form', { title: 'T' });
      expect(result.isError).toBe(true);
    });

    it('should reject select field without options', async () => {
      const result = await handleToolCall('show_form', {
        title: 'T',
        fields: [{ name: 'x', label: 'X', type: 'select' }],
      });
      expect(result.isError).toBe(true);
    });
  });

  // ========== show_message ==========
  describe('show_message', () => {
    it('should create info message by default', async () => {
      mockFetchSuccess({ ...mockCanvas, id: 'msg-1' });
      const result = await handleToolCall('show_message', {
        title: 'Notice',
        content: 'Hello world',
      });
      expect(result.isError).toBeUndefined();
      const parsed = parseResult(result);
      expect(parsed.style).toBe('info');
    });

    it('should create alert for warning style', async () => {
      mockFetchSuccess(mockCanvas);
      await handleToolCall('show_message', {
        title: 'Warning',
        content: 'Be careful!',
        style: 'warning',
      });
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body);
      const message = body.components[0].children[1];
      expect(message.type).toBe('alert');
      expect(message.props.variant).toBe('warning');
    });

    it('should create markdown component for markdown style', async () => {
      mockFetchSuccess(mockCanvas);
      await handleToolCall('show_message', {
        title: 'Doc',
        content: '# Hello\n**bold**',
        style: 'markdown',
      });
      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(call[1].body);
      const message = body.components[0].children[1];
      expect(message.type).toBe('markdown');
      expect(message.props.content).toBe('# Hello\n**bold**');
    });

    it('should reject missing title', async () => {
      const result = await handleToolCall('show_message', { content: 'X' });
      expect(result.isError).toBe(true);
    });

    it('should reject missing content', async () => {
      const result = await handleToolCall('show_message', { title: 'X' });
      expect(result.isError).toBe(true);
    });

    it('should handle connection errors', async () => {
      mockFetchConnectionError();
      const result = await handleToolCall('show_message', {
        title: 'X',
        content: 'Y',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Cannot connect to Canvas API');
    });
  });

  // ========== Unknown tool ==========
  describe('unknown tool', () => {
    it('should return error for unknown tool name', async () => {
      const result = await handleToolCall('nonexistent_tool', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool: nonexistent_tool');
    });
  });
});
