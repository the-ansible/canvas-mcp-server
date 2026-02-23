import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mockFetchSuccess,
  mockFetchCreated,
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
import { apiCall } from './index.js';

const API_BASE_URL = 'http://localhost:3001/api';

describe('API Helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetFetchMock();
  });

  describe('apiCall', () => {
    it('should make successful GET request', async () => {
      mockFetchSuccess(mockCanvases);

      const result = await apiCall('/canvases');

      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases`,
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        })
      );
      expect(result).toEqual(mockCanvases);
    });

    it('should make successful POST request with body', async () => {
      mockFetchSuccess(mockCanvas);

      const body = { title: 'Test', components: [] };
      const result = await apiCall('/canvases', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        })
      );
      expect(result).toEqual(mockCanvas);
    });

    it('should throw on API error response', async () => {
      mockFetchError(404, 'Canvas not found');

      await expect(apiCall('/canvases/nonexistent')).rejects.toThrow(
        'API call failed (404): Canvas not found'
      );
    });

    it('should throw helpful message on connection error', async () => {
      mockFetchConnectionError();

      await expect(apiCall('/canvases')).rejects.toThrow(
        'Cannot connect to Canvas API'
      );
    });

    it('should make PATCH request', async () => {
      mockFetchSuccess(mockCanvas);

      const body = { state: { visible: true } };
      await apiCall('/canvases/abc-123', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });

      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases/abc-123`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      );
    });

    it('should make DELETE request', async () => {
      mockFetchSuccess({ deleted: true, id: 'abc-123' });

      const result = await apiCall('/canvases/abc-123', {
        method: 'DELETE',
      });

      expect(result).toEqual({ deleted: true, id: 'abc-123' });
    });
  });
});

describe('Canvas Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetFetchMock();
  });

  describe('list_canvases', () => {
    it('should fetch all canvases', async () => {
      mockFetchSuccess(mockCanvases);
      const result = await apiCall('/canvases');
      expect(result).toEqual(mockCanvases);
      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases`,
        expect.any(Object)
      );
    });
  });

  describe('create_canvas', () => {
    it('should create canvas from a full descriptor JSON', async () => {
      mockFetchSuccess(mockCanvas);

      const descriptor = {
        title: 'Test Canvas',
        components: [{ id: 'text-1', type: 'text', props: { content: 'Hello' } }],
      };
      const result = await apiCall('/canvases', {
        method: 'POST',
        body: JSON.stringify(descriptor),
      });

      expect(result).toEqual(mockCanvas);
      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(descriptor),
        })
      );
    });
  });

  describe('get_canvas', () => {
    it('should fetch a single canvas by id', async () => {
      mockFetchSuccess(mockCanvas);

      const result = await apiCall('/canvases/abc-123');
      expect(result).toEqual(mockCanvas);
      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases/abc-123`,
        expect.any(Object)
      );
    });

    it('should throw on 404', async () => {
      mockFetchError(404, 'Canvas not found');
      await expect(apiCall('/canvases/nonexistent')).rejects.toThrow('404');
    });
  });

  describe('update_canvas', () => {
    it('should update canvas descriptor', async () => {
      mockFetchSuccess(mockCanvas);

      const body = { descriptor: { title: 'Updated', components: [] } };
      await apiCall('/canvases/abc-123', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });

      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases/abc-123`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      );
    });

    it('should update canvas state', async () => {
      mockFetchSuccess(mockCanvas);

      const body = { state: { theme: 'dark' } };
      await apiCall('/canvases/abc-123', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });

      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases/abc-123`,
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('should update component states', async () => {
      mockFetchSuccess(mockCanvas);

      const body = {
        components: [{ id: 'input-1', state: { value: 'new' } }],
      };
      await apiCall('/canvases/abc-123', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });

      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases/abc-123`,
        expect.objectContaining({ method: 'PATCH' })
      );
    });
  });

  describe('delete_canvas', () => {
    it('should delete a canvas', async () => {
      mockFetchSuccess({ deleted: true, id: 'abc-123' });

      const result = await apiCall('/canvases/abc-123', { method: 'DELETE' });
      expect(result).toEqual({ deleted: true, id: 'abc-123' });
    });
  });

  describe('get_canvas_url', () => {
    it('should return URL for an existing canvas', async () => {
      mockFetchSuccess(mockCanvas);

      // First verifies the canvas exists via GET
      const result = await apiCall('/canvases/abc-123');
      expect(result).toEqual(mockCanvas);
    });

    it('should throw on 404 when canvas does not exist', async () => {
      mockFetchError(404, 'Canvas not found');
      await expect(apiCall('/canvases/nonexistent')).rejects.toThrow('404');
    });
  });

  describe('get_canvas_state', () => {
    it('should get full state snapshot', async () => {
      mockFetchSuccess(mockStateSnapshot);

      const result = await apiCall('/canvases/abc-123/state');
      expect(result).toEqual(mockStateSnapshot);
    });
  });

  describe('get_component_state', () => {
    it('should get single component state', async () => {
      mockFetchSuccess(mockComponentState);

      const result = await apiCall('/canvases/abc-123/state/input-1');
      expect(result).toEqual(mockComponentState);
    });
  });

  describe('post_action', () => {
    it('should post an action event', async () => {
      mockFetchSuccess(mockEvent);

      const body = {
        componentId: 'btn-1',
        eventType: 'click',
      };
      const result = await apiCall('/canvases/abc-123/actions', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      expect(result).toEqual(mockEvent);
    });

    it('should post action with value and metadata', async () => {
      mockFetchSuccess(mockEvent);

      const body = {
        componentId: 'input-1',
        eventType: 'change',
        value: 'hello',
        metadata: { source: 'keyboard' },
      };
      await apiCall('/canvases/abc-123/actions', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases/abc-123/actions`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        })
      );
    });
  });

  describe('add_component', () => {
    it('should add a component to a canvas', async () => {
      const mockResult = { added: { id: 'text-2', type: 'text' }, canvas: mockCanvas };
      mockFetchSuccess(mockResult);

      const body = {
        component: { id: 'text-2', type: 'text', props: { content: 'New' } },
      };
      const result = await apiCall('/canvases/abc-123/components', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      expect(result).toEqual(mockResult);
      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases/abc-123/components`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        })
      );
    });

    it('should add a component with parentId and position', async () => {
      const mockResult = { added: { id: 'input-3', type: 'input' }, canvas: mockCanvas };
      mockFetchSuccess(mockResult);

      const body = {
        component: { id: 'input-3', type: 'input', props: { label: 'Phone' } },
        parentId: 'form-1',
        position: 2,
      };
      const result = await apiCall('/canvases/abc-123/components', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      expect(result).toEqual(mockResult);
    });
  });

  describe('update_component', () => {
    it('should update a component props', async () => {
      const mockResult = {
        updated: { id: 'text-1', type: 'text', props: { content: 'Updated' } },
        canvas: mockCanvas,
      };
      mockFetchSuccess(mockResult);

      const body = { props: { content: 'Updated' } };
      const result = await apiCall('/canvases/abc-123/components/text-1', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });

      expect(result).toEqual(mockResult);
      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases/abc-123/components/text-1`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      );
    });

    it('should update component style', async () => {
      const mockResult = {
        updated: { id: 'btn-1', type: 'button', style: { color: 'red' } },
        canvas: mockCanvas,
      };
      mockFetchSuccess(mockResult);

      const body = { style: { color: 'red' } };
      await apiCall('/canvases/abc-123/components/btn-1', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });

      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases/abc-123/components/btn-1`,
        expect.objectContaining({ method: 'PATCH' })
      );
    });
  });

  describe('remove_component', () => {
    it('should remove a component', async () => {
      const mockResult = {
        removed: { id: 'text-1', type: 'text' },
        canvas: mockCanvas,
      };
      mockFetchSuccess(mockResult);

      const result = await apiCall('/canvases/abc-123/components/text-1', {
        method: 'DELETE',
      });

      expect(result).toEqual(mockResult);
      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases/abc-123/components/text-1`,
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('get_events', () => {
    it('should get events for a canvas', async () => {
      mockFetchSuccess(mockEventsResponse);

      const result = await apiCall('/canvases/abc-123/events');
      expect(result).toEqual(mockEventsResponse);
    });

    it('should pass query parameters for filtering', async () => {
      mockFetchSuccess(mockEventsResponse);

      await apiCall('/canvases/abc-123/events?componentId=btn-1&eventType=click&limit=50');

      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases/abc-123/events?componentId=btn-1&eventType=click&limit=50`,
        expect.any(Object)
      );
    });
  });

  describe('get_pending_events', () => {
    it('should get pending events for a canvas', async () => {
      mockFetchSuccess(mockPendingEventsResponse);

      const result = await apiCall('/canvases/abc-123/events/pending');
      expect(result).toEqual(mockPendingEventsResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases/abc-123/events/pending`,
        expect.any(Object)
      );
    });

    it('should pass query parameters for filtering', async () => {
      mockFetchSuccess(mockPendingEventsResponse);

      await apiCall('/canvases/abc-123/events/pending?componentId=btn-1&eventType=click');

      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases/abc-123/events/pending?componentId=btn-1&eventType=click`,
        expect.any(Object)
      );
    });

    it('should handle empty pending events', async () => {
      mockFetchSuccess({ events: [], total: 0 });

      const result = await apiCall('/canvases/abc-123/events/pending');
      expect(result).toEqual({ events: [], total: 0 });
    });
  });

  describe('acknowledge_event', () => {
    it('should acknowledge a single event', async () => {
      mockFetchSuccess(mockAcknowledgeResponse);

      const result = await apiCall('/canvases/abc-123/events/evt-1/acknowledge', {
        method: 'POST',
      });

      expect(result).toEqual(mockAcknowledgeResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases/abc-123/events/evt-1/acknowledge`,
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should acknowledge multiple events in batch', async () => {
      mockFetchSuccess(mockBatchAcknowledgeResponse);

      const body = { eventIds: ['evt-1', 'evt-2'] };
      const result = await apiCall('/canvases/abc-123/events/acknowledge', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      expect(result).toEqual(mockBatchAcknowledgeResponse);
      expect(fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/canvases/abc-123/events/acknowledge`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        })
      );
    });

    it('should throw on 404 when event not found', async () => {
      mockFetchError(404, 'Event not found or already acknowledged');
      await expect(
        apiCall('/canvases/abc-123/events/nonexistent/acknowledge', { method: 'POST' })
      ).rejects.toThrow('404');
    });
  });

  describe('subscribe_to_events', () => {
    it('should fetch all pending events when no filters provided', async () => {
      mockFetchSuccess(mockPendingEventsResponse);

      const result = await apiCall('/canvases/abc-123/events/pending');
      expect(result).toEqual(mockPendingEventsResponse);
    });

    it('should fetch pending events filtered by componentId', async () => {
      const filtered = {
        events: [mockPendingEventsResponse.events[0]],
        total: 1,
      };
      mockFetchSuccess(filtered);

      const result = await apiCall('/canvases/abc-123/events/pending?componentId=btn-1');
      expect(result).toEqual(filtered);
    });

    it('should fetch pending events filtered by eventType', async () => {
      const filtered = {
        events: [mockPendingEventsResponse.events[1]],
        total: 1,
      };
      mockFetchSuccess(filtered);

      const result = await apiCall('/canvases/abc-123/events/pending?eventType=change');
      expect(result).toEqual(filtered);
    });
  });
});
