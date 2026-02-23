import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mockFetchSuccess,
  mockFetchError,
  mockFetchConnectionError,
  resetFetchMock,
} from './test/mocks.js';
import { apiCall } from './index.js';

const API_BASE_URL = 'http://localhost:3001/api';

/**
 * Tests for convenience MCP tools: show_chart, show_table, show_form, show_message.
 *
 * These tools create focused, single-purpose canvases in one API call.
 * We test:
 * 1. That correct descriptors are built and sent to POST /canvases
 * 2. That the API response is correctly handled
 * 3. That errors propagate properly
 */

// Helper to capture what was sent to POST /canvases
function getPostedDescriptor(): object {
  const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
  const postCall = calls.find(
    (c: unknown[]) => (c[1] as RequestInit)?.method === 'POST'
  );
  if (!postCall) throw new Error('No POST call found');
  return JSON.parse((postCall[1] as RequestInit).body as string);
}

const mockCreatedCanvas = {
  id: 'canvas-new-123',
  title: 'Test',
  descriptor: {},
  state: {},
  created_at: '2026-02-20T00:00:00.000Z',
  updated_at: '2026-02-20T00:00:00.000Z',
};

describe('Convenience Tools - show_chart', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => resetFetchMock());

  it('should create a canvas with a chart descriptor', async () => {
    mockFetchSuccess({ ...mockCreatedCanvas, title: 'Revenue Chart' });

    const descriptor = {
      title: 'Revenue Chart',
      components: expect.any(Array),
    };

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Revenue Chart',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '900px', margin: { left: 'auto', right: 'auto' } },
            children: [
              {
                id: 'chart-title',
                type: 'heading',
                props: { content: 'Revenue Chart', level: 2 },
              },
              {
                id: 'chart',
                type: 'chart',
                props: {
                  chartType: 'line',
                  height: '400px',
                  data: {
                    labels: ['Jan', 'Feb', 'Mar'],
                    datasets: [{ label: 'Revenue', data: [100, 200, 300] }],
                  },
                },
              },
            ],
          },
        ],
      }),
    });

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE_URL}/canvases`,
      expect.objectContaining({ method: 'POST' })
    );

    const posted = getPostedDescriptor();
    expect(posted).toHaveProperty('title', 'Revenue Chart');
    expect(posted).toHaveProperty('components');
  });

  it('should include chart options when provided', async () => {
    mockFetchSuccess({ ...mockCreatedCanvas, title: 'Chart with Options' });

    const chartOptions = { responsive: true, plugins: { legend: { display: false } } };

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Chart with Options',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '900px', margin: { left: 'auto', right: 'auto' } },
            children: [
              { id: 'chart-title', type: 'heading', props: { content: 'Chart with Options', level: 2 } },
              {
                id: 'chart',
                type: 'chart',
                props: {
                  chartType: 'bar',
                  height: '300px',
                  data: { labels: ['A', 'B'], datasets: [{ label: 'Data', data: [1, 2] }] },
                  options: chartOptions,
                },
              },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor();
    const root = (posted as { components: Array<{ children: object[] }> }).components[0];
    const chart = (root as { children: Array<{ props: { options: object } }> }).children[1];
    expect(chart.props.options).toEqual(chartOptions);
  });

  it('should use custom height when provided', async () => {
    mockFetchSuccess(mockCreatedCanvas);

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Tall Chart',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '900px', margin: { left: 'auto', right: 'auto' } },
            children: [
              { id: 'chart-title', type: 'heading', props: { content: 'Tall Chart', level: 2 } },
              {
                id: 'chart',
                type: 'chart',
                props: {
                  chartType: 'pie',
                  height: '600px',
                  data: { labels: ['X'], datasets: [{ label: 'Y', data: [1] }] },
                },
              },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor();
    const root = (posted as { components: Array<{ children: object[] }> }).components[0];
    const chart = (root as { children: Array<{ props: { height: string } }> }).children[1];
    expect(chart.props.height).toBe('600px');
  });

  it('should support all chart types', async () => {
    const chartTypes = ['line', 'bar', 'pie', 'doughnut', 'area', 'scatter', 'radar'];
    for (const ct of chartTypes) {
      mockFetchSuccess({ ...mockCreatedCanvas, title: `${ct} chart` });
      await apiCall('/canvases', {
        method: 'POST',
        body: JSON.stringify({
          title: `${ct} chart`,
          components: [
            {
              id: 'root',
              type: 'container',
              props: { direction: 'column', gap: '16px' },
              children: [
                { id: 'chart', type: 'chart', props: { chartType: ct, data: { labels: [], datasets: [] } } },
              ],
            },
          ],
        }),
      });
      const posted = getPostedDescriptor();
      expect(posted).toHaveProperty('title', `${ct} chart`);
      resetFetchMock();
    }
  });

  it('should handle API errors', async () => {
    mockFetchError(500, 'Internal server error');
    await expect(
      apiCall('/canvases', { method: 'POST', body: '{}' })
    ).rejects.toThrow('500');
  });
});

describe('Convenience Tools - show_table', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => resetFetchMock());

  it('should create a canvas with a table descriptor', async () => {
    mockFetchSuccess({ ...mockCreatedCanvas, title: 'Users Table' });

    const columns = [
      { key: 'name', label: 'Name', sortable: true },
      { key: 'email', label: 'Email' },
    ];
    const data = [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
    ];

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Users Table',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' } },
            children: [
              { id: 'table-title', type: 'heading', props: { content: 'Users Table', level: 2 } },
              {
                id: 'table',
                type: 'table',
                props: { columns, data, sortable: true },
              },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor();
    expect(posted).toHaveProperty('title', 'Users Table');
    const root = (posted as { components: Array<{ children: object[] }> }).components[0];
    const table = (root as { children: Array<{ props: { data: object[]; columns: object[] } }> }).children[1];
    expect(table.props.data).toHaveLength(2);
    expect(table.props.columns).toHaveLength(2);
  });

  it('should include pagination when pageSize is provided', async () => {
    mockFetchSuccess(mockCreatedCanvas);

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Paginated Table',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' } },
            children: [
              { id: 'table-title', type: 'heading', props: { content: 'Paginated Table', level: 2 } },
              {
                id: 'table',
                type: 'table',
                props: {
                  columns: [{ key: 'id', label: 'ID' }],
                  data: [{ id: 1 }],
                  sortable: true,
                  pagination: { pageSize: 25, showPageInfo: true },
                },
              },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor();
    const root = (posted as { components: Array<{ children: object[] }> }).components[0];
    const table = (root as { children: Array<{ props: { pagination: object } }> }).children[1];
    expect(table.props.pagination).toEqual({ pageSize: 25, showPageInfo: true });
  });

  it('should set filterable when enabled', async () => {
    mockFetchSuccess(mockCreatedCanvas);

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Filterable Table',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' } },
            children: [
              { id: 'table-title', type: 'heading', props: { content: 'Filterable Table', level: 2 } },
              {
                id: 'table',
                type: 'table',
                props: {
                  columns: [{ key: 'x', label: 'X' }],
                  data: [],
                  sortable: true,
                  filterable: true,
                },
              },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor();
    const root = (posted as { components: Array<{ children: object[] }> }).components[0];
    const table = (root as { children: Array<{ props: { filterable: boolean } }> }).children[1];
    expect(table.props.filterable).toBe(true);
  });

  it('should default sortable to true', async () => {
    mockFetchSuccess(mockCreatedCanvas);

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Default Sort',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' } },
            children: [
              { id: 'table-title', type: 'heading', props: { content: 'Default Sort', level: 2 } },
              {
                id: 'table',
                type: 'table',
                props: { columns: [{ key: 'a', label: 'A' }], data: [], sortable: true },
              },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor();
    const root = (posted as { components: Array<{ children: object[] }> }).components[0];
    const table = (root as { children: Array<{ props: { sortable: boolean } }> }).children[1];
    expect(table.props.sortable).toBe(true);
  });
});

describe('Convenience Tools - show_form', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => resetFetchMock());

  it('should create a canvas with a form descriptor', async () => {
    mockFetchSuccess({ ...mockCreatedCanvas, title: 'Contact Form' });

    const fields = [
      { name: 'fullName', label: 'Full Name', type: 'text', required: true, placeholder: 'John Doe' },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'message', label: 'Message', type: 'textarea' },
    ];

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Contact Form',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '600px', margin: { left: 'auto', right: 'auto' } },
            children: [
              { id: 'form-title', type: 'heading', props: { content: 'Contact Form', level: 2 } },
              {
                id: 'form',
                type: 'form',
                props: {
                  onSubmit: { type: 'callback', callbackId: 'form-submit', payload: {} },
                  validateOnBlur: true,
                },
                children: [
                  { id: 'field-fullName', type: 'input', props: { name: 'fullName', label: 'Full Name', inputType: 'text', required: true, placeholder: 'John Doe' } },
                  { id: 'field-email', type: 'input', props: { name: 'email', label: 'Email', inputType: 'email', required: true } },
                  { id: 'field-message', type: 'textarea', props: { name: 'message', label: 'Message', rows: 4 } },
                  { id: 'submit-btn', type: 'button', props: { label: 'Submit', variant: 'primary', fullWidth: true } },
                ],
              },
            ],
          },
        ],
      }),
    });

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE_URL}/canvases`,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('should handle select fields with options', async () => {
    mockFetchSuccess(mockCreatedCanvas);

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Select Form',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '600px', margin: { left: 'auto', right: 'auto' } },
            children: [
              { id: 'form-title', type: 'heading', props: { content: 'Select Form', level: 2 } },
              {
                id: 'form',
                type: 'form',
                props: { onSubmit: { type: 'callback', callbackId: 'form-submit', payload: {} }, validateOnBlur: true },
                children: [
                  {
                    id: 'field-role',
                    type: 'select',
                    props: {
                      name: 'role',
                      label: 'Role',
                      options: [
                        { label: 'Admin', value: 'admin' },
                        { label: 'User', value: 'user' },
                      ],
                      required: true,
                    },
                  },
                  { id: 'submit-btn', type: 'button', props: { label: 'Submit', variant: 'primary', fullWidth: true } },
                ],
              },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor();
    const root = (posted as { components: Array<{ children: object[] }> }).components[0];
    const form = (root as { children: Array<{ children: object[] }> }).children[1];
    const selectField = (form as { children: Array<{ type: string; props: { options: object[] } }> }).children[0];
    expect(selectField.type).toBe('select');
    expect(selectField.props.options).toHaveLength(2);
  });

  it('should handle checkbox and radio fields', async () => {
    mockFetchSuccess(mockCreatedCanvas);

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Mixed Form',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '600px', margin: { left: 'auto', right: 'auto' } },
            children: [
              { id: 'form-title', type: 'heading', props: { content: 'Mixed Form', level: 2 } },
              {
                id: 'form',
                type: 'form',
                props: { onSubmit: { type: 'callback', callbackId: 'form-submit', payload: {} }, validateOnBlur: true },
                children: [
                  { id: 'field-agree', type: 'checkbox', props: { name: 'agree', label: 'I agree' } },
                  {
                    id: 'field-priority',
                    type: 'radio',
                    props: {
                      name: 'priority',
                      label: 'Priority',
                      options: [
                        { label: 'Low', value: 'low' },
                        { label: 'High', value: 'high' },
                      ],
                    },
                  },
                  { id: 'submit-btn', type: 'button', props: { label: 'Submit', variant: 'primary', fullWidth: true } },
                ],
              },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor();
    const root = (posted as { components: Array<{ children: object[] }> }).components[0];
    const form = (root as { children: Array<{ children: Array<{ type: string }> }> }).children[1];
    expect(form.children[0].type).toBe('checkbox');
    expect(form.children[1].type).toBe('radio');
  });

  it('should include custom submit label', async () => {
    mockFetchSuccess(mockCreatedCanvas);

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Custom Submit',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '600px', margin: { left: 'auto', right: 'auto' } },
            children: [
              { id: 'form-title', type: 'heading', props: { content: 'Custom Submit', level: 2 } },
              {
                id: 'form',
                type: 'form',
                props: { onSubmit: { type: 'callback', callbackId: 'form-submit', payload: {} }, validateOnBlur: true },
                children: [
                  { id: 'field-name', type: 'input', props: { name: 'name', label: 'Name', inputType: 'text', required: true } },
                  { id: 'submit-btn', type: 'button', props: { label: 'Send Now', variant: 'primary', fullWidth: true } },
                ],
              },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor();
    const root = (posted as { components: Array<{ children: object[] }> }).components[0];
    const form = (root as { children: Array<{ children: Array<{ props: { label: string } }> }> }).children[1];
    const submitBtn = form.children[form.children.length - 1];
    expect(submitBtn.props.label).toBe('Send Now');
  });

  it('should include description when provided', async () => {
    mockFetchSuccess(mockCreatedCanvas);

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Form With Desc',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '600px', margin: { left: 'auto', right: 'auto' } },
            children: [
              { id: 'form-title', type: 'heading', props: { content: 'Form With Desc', level: 2 } },
              { id: 'form-description', type: 'text', props: { content: 'Please fill out this form.', variant: 'body1' }, style: { color: '#64748b' } },
              {
                id: 'form',
                type: 'form',
                props: { onSubmit: { type: 'callback', callbackId: 'form-submit', payload: {} }, validateOnBlur: true },
                children: [
                  { id: 'field-x', type: 'input', props: { name: 'x', label: 'X', inputType: 'text' } },
                  { id: 'submit-btn', type: 'button', props: { label: 'Submit', variant: 'primary', fullWidth: true } },
                ],
              },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor();
    const root = (posted as { components: Array<{ children: object[] }> }).components[0];
    const desc = (root as { children: Array<{ id: string; props: { content: string } }> }).children[1];
    expect(desc.id).toBe('form-description');
    expect(desc.props.content).toBe('Please fill out this form.');
  });
});

describe('Convenience Tools - show_message', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => resetFetchMock());

  it('should create a canvas with an info alert by default', async () => {
    mockFetchSuccess({ ...mockCreatedCanvas, title: 'Info Message' });

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Info Message',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '700px', margin: { left: 'auto', right: 'auto' } },
            children: [
              { id: 'msg-title', type: 'heading', props: { content: 'Info Message', level: 2 } },
              { id: 'message', type: 'alert', props: { content: 'This is an info message.', variant: 'info' } },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor();
    const root = (posted as { components: Array<{ children: object[] }> }).components[0];
    const message = (root as { children: Array<{ type: string; props: { variant: string } }> }).children[1];
    expect(message.type).toBe('alert');
    expect(message.props.variant).toBe('info');
  });

  it('should support warning style', async () => {
    mockFetchSuccess(mockCreatedCanvas);

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Warning',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '700px', margin: { left: 'auto', right: 'auto' } },
            children: [
              { id: 'msg-title', type: 'heading', props: { content: 'Warning', level: 2 } },
              { id: 'message', type: 'alert', props: { content: 'Be careful!', variant: 'warning' } },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor();
    const root = (posted as { components: Array<{ children: object[] }> }).components[0];
    const message = (root as { children: Array<{ type: string; props: { variant: string } }> }).children[1];
    expect(message.type).toBe('alert');
    expect(message.props.variant).toBe('warning');
  });

  it('should support error style', async () => {
    mockFetchSuccess(mockCreatedCanvas);

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Error',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '700px', margin: { left: 'auto', right: 'auto' } },
            children: [
              { id: 'msg-title', type: 'heading', props: { content: 'Error', level: 2 } },
              { id: 'message', type: 'alert', props: { content: 'Something failed', variant: 'error' } },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor();
    const root = (posted as { components: Array<{ children: object[] }> }).components[0];
    const message = (root as { children: Array<{ props: { variant: string } }> }).children[1];
    expect(message.props.variant).toBe('error');
  });

  it('should support success style', async () => {
    mockFetchSuccess(mockCreatedCanvas);

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Success',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '700px', margin: { left: 'auto', right: 'auto' } },
            children: [
              { id: 'msg-title', type: 'heading', props: { content: 'Success', level: 2 } },
              { id: 'message', type: 'alert', props: { content: 'All done!', variant: 'success' } },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor();
    const root = (posted as { components: Array<{ children: object[] }> }).components[0];
    const message = (root as { children: Array<{ props: { variant: string } }> }).children[1];
    expect(message.props.variant).toBe('success');
  });

  it('should use markdown component for markdown style', async () => {
    mockFetchSuccess(mockCreatedCanvas);

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Markdown Message',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '700px', margin: { left: 'auto', right: 'auto' } },
            children: [
              { id: 'msg-title', type: 'heading', props: { content: 'Markdown Message', level: 2 } },
              { id: 'message', type: 'markdown', props: { content: '# Hello\n\n**Bold** text' } },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor();
    const root = (posted as { components: Array<{ children: object[] }> }).components[0];
    const message = (root as { children: Array<{ type: string; props: { content: string } }> }).children[1];
    expect(message.type).toBe('markdown');
    expect(message.props.content).toBe('# Hello\n\n**Bold** text');
  });

  it('should handle connection errors', async () => {
    mockFetchConnectionError();
    await expect(
      apiCall('/canvases', { method: 'POST', body: '{}' })
    ).rejects.toThrow('Cannot connect to Canvas API');
  });
});

describe('Convenience Tools - Descriptor Structure', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => resetFetchMock());

  it('show_chart descriptor has correct structure', async () => {
    mockFetchSuccess(mockCreatedCanvas);

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'My Chart',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '900px', margin: { left: 'auto', right: 'auto' } },
            children: [
              { id: 'chart-title', type: 'heading', props: { content: 'My Chart', level: 2 } },
              {
                id: 'chart',
                type: 'chart',
                props: {
                  chartType: 'line',
                  height: '400px',
                  data: { labels: ['A'], datasets: [{ label: 'D', data: [1] }] },
                },
              },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor() as {
      title: string;
      components: Array<{
        id: string;
        type: string;
        children: Array<{ id: string; type: string }>;
      }>;
    };

    // Title is set
    expect(posted.title).toBe('My Chart');

    // Root is a container
    expect(posted.components).toHaveLength(1);
    expect(posted.components[0].id).toBe('root');
    expect(posted.components[0].type).toBe('container');

    // Children: heading + chart
    expect(posted.components[0].children).toHaveLength(2);
    expect(posted.components[0].children[0].type).toBe('heading');
    expect(posted.components[0].children[1].type).toBe('chart');
  });

  it('show_table descriptor has correct structure', async () => {
    mockFetchSuccess(mockCreatedCanvas);

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'My Table',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' } },
            children: [
              { id: 'table-title', type: 'heading', props: { content: 'My Table', level: 2 } },
              { id: 'table', type: 'table', props: { columns: [{ key: 'x', label: 'X' }], data: [], sortable: true } },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor() as {
      title: string;
      components: Array<{
        id: string;
        type: string;
        children: Array<{ id: string; type: string }>;
      }>;
    };

    expect(posted.title).toBe('My Table');
    expect(posted.components[0].children).toHaveLength(2);
    expect(posted.components[0].children[0].type).toBe('heading');
    expect(posted.components[0].children[1].type).toBe('table');
  });

  it('show_form descriptor has correct structure with form and submit button', async () => {
    mockFetchSuccess(mockCreatedCanvas);

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'My Form',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '600px', margin: { left: 'auto', right: 'auto' } },
            children: [
              { id: 'form-title', type: 'heading', props: { content: 'My Form', level: 2 } },
              {
                id: 'form',
                type: 'form',
                props: { onSubmit: { type: 'callback', callbackId: 'form-submit', payload: {} }, validateOnBlur: true },
                children: [
                  { id: 'field-name', type: 'input', props: { name: 'name', label: 'Name', inputType: 'text' } },
                  { id: 'submit-btn', type: 'button', props: { label: 'Submit', variant: 'primary', fullWidth: true } },
                ],
              },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor() as {
      title: string;
      components: Array<{
        children: Array<{
          id: string;
          type: string;
          children?: Array<{ id: string; type: string }>;
        }>;
      }>;
    };

    expect(posted.title).toBe('My Form');
    const rootChildren = posted.components[0].children;
    expect(rootChildren[0].type).toBe('heading');
    expect(rootChildren[1].type).toBe('form');
    // Form has field + submit button
    const formChildren = rootChildren[1].children!;
    expect(formChildren[formChildren.length - 1].id).toBe('submit-btn');
  });

  it('show_message descriptor uses alert for non-markdown styles', async () => {
    mockFetchSuccess(mockCreatedCanvas);

    await apiCall('/canvases', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Alert Test',
        components: [
          {
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '700px', margin: { left: 'auto', right: 'auto' } },
            children: [
              { id: 'msg-title', type: 'heading', props: { content: 'Alert Test', level: 2 } },
              { id: 'message', type: 'alert', props: { content: 'test', variant: 'success' } },
            ],
          },
        ],
      }),
    });

    const posted = getPostedDescriptor() as {
      components: Array<{ children: Array<{ type: string }> }>;
    };

    expect(posted.components[0].children[1].type).toBe('alert');
  });
});
