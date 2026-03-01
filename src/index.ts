#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { waitForCanvasEvent } from './ws-client.js';

// API base URL for the Dynamic UI Canvas server
const API_BASE_URL = 'http://localhost:3001/api';

// Web app URL where users can view canvases in the browser (via Caddy gateway on :3003)
const CANVAS_WEB_APP_URL = 'http://localhost:3003/apps/canvas/';

// Outbound messaging — routes through stimulation server composer for voice consistency
const OUTBOUND_WEBHOOK_URL = 'http://localhost:3102/api/compose-and-send';

// Types matching the Canvas API
interface Canvas {
  id: string;
  title: string;
  descriptor: object;
  state: object;
  created_at: string;
  updated_at: string;
}

interface CanvasSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface CanvasEvent {
  id: string;
  canvas_id: string;
  event_type: string;
  payload: object;
  created_at: string;
}

interface EventsResponse {
  events: CanvasEvent[];
  total: number;
  offset: number;
  limit: number;
}

interface PendingEventsResponse {
  events: CanvasEvent[];
  total: number;
}

interface AcknowledgeResponse {
  acknowledged: boolean | number;
  eventId?: string;
  eventIds?: string[];
}

interface ComponentState {
  state: object;
  updatedAt: string;
}

interface CanvasStateSnapshot {
  canvasId: string;
  snapshotAt: string;
  components: Record<string, object>;
  formValidity: object;
}

// Validation helpers
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function validateRequired(value: unknown, fieldName: string): void {
  if (value === undefined || value === null) {
    throw new ValidationError(`Missing required field: ${fieldName}`);
  }
}

function validateString(value: unknown, fieldName: string, required = true): void {
  if (required) {
    validateRequired(value, fieldName);
  }
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new ValidationError(`Field '${fieldName}' must be a string, got ${typeof value}`);
  }
  if (required && typeof value === 'string' && value.trim().length === 0) {
    throw new ValidationError(`Field '${fieldName}' cannot be empty`);
  }
}

function validateNumber(value: unknown, fieldName: string, required = true): void {
  if (required) {
    validateRequired(value, fieldName);
  }
  if (value !== undefined && value !== null && typeof value !== 'number') {
    throw new ValidationError(`Field '${fieldName}' must be a number, got ${typeof value}`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new ValidationError(`Field '${fieldName}' must be a finite number`);
  }
}

function validateArray(value: unknown, fieldName: string, required = true): void {
  if (required) {
    validateRequired(value, fieldName);
  }
  if (value !== undefined && value !== null && !Array.isArray(value)) {
    throw new ValidationError(`Field '${fieldName}' must be an array, got ${typeof value}`);
  }
}

function validateObject(value: unknown, fieldName: string, required = true): void {
  if (required) {
    validateRequired(value, fieldName);
  }
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) {
    throw new ValidationError(`Field '${fieldName}' must be an object, got ${typeof value}`);
  }
}

// Helper function to make API calls
export async function apiCall<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API call failed (${response.status}): ${error}`);
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(
        `Cannot connect to Canvas API at ${API_BASE_URL}. ` +
        `Please ensure the Canvas server is running on port 3001. ` +
        `You can start it with: cd dynamic-ui-canvas && npm run dev`
      );
    }
    throw error;
  }
}

// Create MCP server
const server = new Server(
  {
    name: 'canvas-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define MCP tools
const tools: Tool[] = [
  {
    name: 'list_canvases',
    description: 'Get all active canvases with summary info (id, title, timestamps)',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_canvas',
    description: 'Create a new canvas from a full descriptor JSON object containing title and components array. Components define the UI layout and interactivity.',
    inputSchema: {
      type: 'object',
      properties: {
        descriptor: {
          type: 'object',
          description: 'Full canvas descriptor object with title and components array. Example: { "title": "My Canvas", "components": [{ "id": "text-1", "type": "text", "props": { "content": "Hello" } }] }',
          properties: {
            title: { type: 'string', description: 'The title of the canvas' },
            components: {
              type: 'array',
              description: 'Array of component descriptors defining the UI',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Unique component identifier' },
                  type: { type: 'string', description: 'Component type (e.g., text, chart, table, form, input, button, container, grid, etc.)' },
                  props: { type: 'object', description: 'Component-specific properties' },
                  children: { type: 'array', description: 'Nested child components' },
                },
                required: ['id', 'type'],
              },
            },
          },
          required: ['title', 'components'],
        },
      },
      required: ['descriptor'],
    },
  },
  {
    name: 'get_canvas',
    description: 'Get a full canvas including descriptor, state, and component states',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The UUID of the canvas',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'update_canvas',
    description: 'Update a canvas by replacing the entire descriptor, merging canvas-level state, or patching individual component states. Provide at least one of: descriptor, state, or components.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The UUID of the canvas to update',
        },
        descriptor: {
          type: 'object',
          description: 'Full replacement descriptor object with title and components. Replaces the entire descriptor.',
        },
        state: {
          type: 'object',
          description: 'Canvas-level state to merge (optional)',
        },
        components: {
          type: 'array',
          description: 'Component updates — array of {id, props?, state?} (optional)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              props: { type: 'object' },
              state: { type: 'object' },
            },
            required: ['id'],
          },
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_canvas',
    description: 'Delete a canvas and all its associated data (events, state). This is irreversible.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The UUID of the canvas to delete',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_canvas_url',
    description: 'Get the URL where the user can open a canvas in their browser. The Canvas Web App must be running for the URL to work.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The UUID of the canvas',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_canvas_state',
    description: 'Get a full state snapshot of all components in a canvas, including form validity',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The UUID of the canvas',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_component_state',
    description: 'Get the state of a single component within a canvas',
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: {
          type: 'string',
          description: 'The UUID of the canvas',
        },
        componentId: {
          type: 'string',
          description: 'The ID of the component',
        },
      },
      required: ['canvasId', 'componentId'],
    },
  },
  {
    name: 'add_component',
    description: 'Add a new component to an existing canvas without replacing the entire descriptor. Supports inserting at a specific position or nesting under a parent component.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: {
          type: 'string',
          description: 'The UUID of the canvas to add the component to',
        },
        component: {
          type: 'object',
          description: 'The component descriptor to add. Must have id and type. Example: { "id": "text-2", "type": "text", "props": { "content": "Hello" } }',
          properties: {
            id: { type: 'string', description: 'Unique component identifier' },
            type: { type: 'string', description: 'Component type (e.g., text, chart, table, form, input, button, container, grid, etc.)' },
            props: { type: 'object', description: 'Component-specific properties' },
            children: { type: 'array', description: 'Nested child components' },
          },
          required: ['id', 'type'],
        },
        parentId: {
          type: 'string',
          description: 'Optional ID of a parent component to nest this component under. If omitted, adds to the top-level components array.',
        },
        position: {
          type: 'number',
          description: 'Optional index position to insert at (0-based). If omitted, appends at the end.',
        },
      },
      required: ['canvasId', 'component'],
    },
  },
  {
    name: 'update_component',
    description: 'Update a specific component within a canvas by its component ID. Merges props and style (shallow merge), replaces children and events arrays.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: {
          type: 'string',
          description: 'The UUID of the canvas',
        },
        componentId: {
          type: 'string',
          description: 'The ID of the component to update',
        },
        props: {
          type: 'object',
          description: 'Properties to merge into the component\'s existing props (shallow merge)',
        },
        style: {
          type: 'object',
          description: 'Style overrides to merge into the component\'s existing style (shallow merge)',
        },
        children: {
          type: 'array',
          description: 'New children array to replace existing children',
          items: { type: 'object' },
        },
        events: {
          type: 'array',
          description: 'New events array to replace existing events',
          items: { type: 'object' },
        },
      },
      required: ['canvasId', 'componentId'],
    },
  },
  {
    name: 'remove_component',
    description: 'Remove a specific component from a canvas by its component ID. Also cleans up associated component state.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: {
          type: 'string',
          description: 'The UUID of the canvas',
        },
        componentId: {
          type: 'string',
          description: 'The ID of the component to remove',
        },
      },
      required: ['canvasId', 'componentId'],
    },
  },
  {
    name: 'post_action',
    description: 'Record a user interaction event on a canvas component (e.g., button click, form input, selection change)',
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: {
          type: 'string',
          description: 'The UUID of the canvas',
        },
        componentId: {
          type: 'string',
          description: 'The ID of the component that was interacted with',
        },
        eventType: {
          type: 'string',
          description: 'The type of event (e.g., click, change, submit)',
        },
        value: {
          description: 'The value associated with the event (optional)',
        },
        metadata: {
          type: 'object',
          description: 'Additional metadata for the event (optional)',
        },
      },
      required: ['canvasId', 'componentId', 'eventType'],
    },
  },
  {
    name: 'get_events',
    description: 'Get the event history/audit log for a canvas, with optional filtering by component or event type',
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: {
          type: 'string',
          description: 'The UUID of the canvas',
        },
        componentId: {
          type: 'string',
          description: 'Filter events by component ID (optional)',
        },
        eventType: {
          type: 'string',
          description: 'Filter events by event type (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of events to return (default 100, max 1000)',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset (default 0)',
        },
      },
      required: ['canvasId'],
    },
  },
  {
    name: 'get_pending_events',
    description: 'Get unacknowledged user action events that Jane has not yet processed. Use this to poll for new user interactions (clicks, form submissions, input changes) on a canvas. Events are returned in chronological order (oldest first).',
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: {
          type: 'string',
          description: 'The UUID of the canvas to check for pending events',
        },
        componentId: {
          type: 'string',
          description: 'Filter pending events by component ID (optional)',
        },
        eventType: {
          type: 'string',
          description: 'Filter pending events by event type, e.g. click, change, submit (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of events to return (default 100, max 1000)',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset (default 0)',
        },
      },
      required: ['canvasId'],
    },
  },
  {
    name: 'acknowledge_event',
    description: 'Mark one or more events as acknowledged/processed by Jane. Call this after handling a user action to prevent it from appearing in future get_pending_events calls. Supports acknowledging a single event or multiple events at once.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: {
          type: 'string',
          description: 'The UUID of the canvas',
        },
        eventId: {
          type: 'string',
          description: 'The ID of a single event to acknowledge. Provide either eventId or eventIds, not both.',
        },
        eventIds: {
          type: 'array',
          description: 'Array of event IDs to acknowledge in batch. Provide either eventId or eventIds, not both.',
          items: { type: 'string' },
        },
      },
      required: ['canvasId'],
    },
  },
  {
    name: 'subscribe_to_events',
    description: 'Get a filtered view of pending events for specific components or event types. This is a convenience wrapper around get_pending_events that returns events matching the subscription criteria. Useful for monitoring specific parts of a canvas (e.g., only form submissions or button clicks).',
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: {
          type: 'string',
          description: 'The UUID of the canvas to monitor',
        },
        componentIds: {
          type: 'array',
          description: 'Array of component IDs to subscribe to. Only events from these components will be returned.',
          items: { type: 'string' },
        },
        eventTypes: {
          type: 'array',
          description: 'Array of event types to subscribe to (e.g., ["click", "submit"]). Only events of these types will be returned.',
          items: { type: 'string' },
        },
      },
      required: ['canvasId'],
    },
  },
  {
    name: 'wait_for_event',
    description:
      'Blocks until a matching event arrives on an existing canvas, then returns it. ' +
      'Uses a WebSocket subscription for instant notification — no polling delay. ' +
      'Use this to wait for user interactions — form submissions, button clicks, game moves, etc. ' +
      'This is the preferred way to implement turn-based interactions or await user input on a canvas you already created.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The canvas ID to watch for events' },
        componentId: { type: 'string', description: 'Only match events from this component (optional)' },
        eventType: { type: 'string', description: 'Only match this event type, e.g. "submit", "click" (default: any)' },
        timeoutSeconds: { type: 'number', description: 'Max seconds to wait (default: 300, max: 3600)' },
        acknowledge: { type: 'boolean', description: 'Auto-acknowledge the matched event (default: true)' },
      },
      required: ['canvasId'],
    },
  },
  // --- Convenience Tools ---
  {
    name: 'show_chart',
    description:
      'One-shot convenience tool: creates a focused canvas displaying a single chart. ' +
      'Abstracts away the full descriptor complexity — just provide the chart data and options. ' +
      'Supports line, bar, pie, doughnut, area, scatter, and radar chart types.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title displayed above the chart (also used as the canvas title)',
        },
        chartType: {
          type: 'string',
          description: 'Chart type: line, bar, pie, doughnut, area, scatter, or radar',
          enum: ['line', 'bar', 'pie', 'doughnut', 'area', 'scatter', 'radar'],
        },
        labels: {
          type: 'array',
          description: 'Array of labels for the X axis (or pie/doughnut segments)',
          items: { type: 'string' },
        },
        datasets: {
          type: 'array',
          description:
            'Array of dataset objects. Each has: label (string), data (number[]), and optional borderColor, backgroundColor, fill (boolean), borderWidth.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              data: { type: 'array', items: { type: 'number' } },
              borderColor: { type: 'string' },
              backgroundColor: {},
              fill: { type: 'boolean' },
              borderWidth: { type: 'number' },
            },
            required: ['label', 'data'],
          },
        },
        height: {
          type: 'string',
          description: 'Chart height in CSS units (default: "400px")',
        },
        options: {
          type: 'object',
          description: 'Optional Chart.js options object (responsive, plugins, scales, etc.)',
        },
      },
      required: ['title', 'chartType', 'labels', 'datasets'],
    },
  },
  {
    name: 'show_table',
    description:
      'One-shot convenience tool: creates a focused canvas displaying a single data table. ' +
      'Abstracts away the full descriptor complexity — just provide columns and rows. ' +
      'Supports sorting, filtering, and pagination out of the box.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title displayed above the table (also used as the canvas title)',
        },
        columns: {
          type: 'array',
          description:
            'Array of column definitions. Each has: key (string matching row data keys), label (display header), and optional sortable (boolean), filterable (boolean), width (CSS string).',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              label: { type: 'string' },
              sortable: { type: 'boolean' },
              filterable: { type: 'boolean' },
              width: { type: 'string' },
            },
            required: ['key', 'label'],
          },
        },
        data: {
          type: 'array',
          description: 'Array of row objects. Each row is an object with keys matching column keys.',
          items: { type: 'object' },
        },
        sortable: {
          type: 'boolean',
          description: 'Enable sorting on all columns (default: true)',
        },
        filterable: {
          type: 'boolean',
          description: 'Enable filtering on all columns (default: false)',
        },
        pageSize: {
          type: 'number',
          description: 'Number of rows per page. Omit to show all rows without pagination.',
        },
      },
      required: ['title', 'columns', 'data'],
    },
  },
  {
    name: 'show_form',
    description:
      'One-shot convenience tool: creates a focused canvas displaying a form. ' +
      'Abstracts away the full descriptor complexity — just provide form field definitions. ' +
      'The form emits a submit event that can be retrieved via get_pending_events. ' +
      'Supports text, email, password, number, date, select, textarea, checkbox, and radio fields.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title displayed above the form (also used as the canvas title)',
        },
        fields: {
          type: 'array',
          description:
            'Array of form field definitions. Each has: name (string), label (string), type (input type or "select"/"textarea"/"checkbox"/"radio"), and optional: required (boolean), placeholder (string), options (for select/radio: array of {label, value}), defaultValue, validation ({minLength, maxLength, min, max, pattern}).',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Field name (used as key in submitted data)' },
              label: { type: 'string', description: 'Display label' },
              type: {
                type: 'string',
                description: 'Field type: text, email, password, number, date, select, textarea, checkbox, radio',
              },
              required: { type: 'boolean' },
              placeholder: { type: 'string' },
              options: {
                type: 'array',
                description: 'Options for select or radio fields',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    value: { type: 'string' },
                  },
                  required: ['label', 'value'],
                },
              },
              defaultValue: { description: 'Default value for the field' },
              validation: {
                type: 'object',
                description: 'Validation rules: minLength, maxLength, min, max, pattern',
              },
            },
            required: ['name', 'label', 'type'],
          },
        },
        submitLabel: {
          type: 'string',
          description: 'Label for the submit button (default: "Submit")',
        },
        description: {
          type: 'string',
          description: 'Optional description text shown below the title and above the form fields',
        },
      },
      required: ['title', 'fields'],
    },
  },
  {
    name: 'show_message',
    description:
      'One-shot convenience tool: creates a focused canvas displaying a rich message or alert. ' +
      'Abstracts away the full descriptor complexity — just provide the message content. ' +
      'Supports plain text, markdown, and alert styles (info, warning, error, success).',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title displayed at the top of the canvas',
        },
        content: {
          type: 'string',
          description: 'The message content. Supports Markdown formatting if style is "markdown".',
        },
        style: {
          type: 'string',
          description: 'Message style: "info", "warning", "error", "success", or "markdown". Default: "info".',
          enum: ['info', 'warning', 'error', 'success', 'markdown'],
        },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'request_user_input',
    description:
      'Creates a form canvas, sends the URL to the user via the outbound messaging channel, ' +
      'and waits for the user to submit the form. Returns the submitted form data. ' +
      'Use this when you need structured user input — e.g., approvals, PR reviews, ' +
      'task parameters, preference questions, feedback collection. ' +
      'For forms only. For custom interactive UIs (games, dashboards, etc.), use interact_with_user instead.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title displayed above the form',
        },
        message: {
          type: 'string',
          description: 'Message sent to the user explaining what input is needed and why. Sent via the outbound webhook alongside the form URL.',
        },
        fields: {
          type: 'array',
          description:
            'Array of form field definitions. Each has: name (string), label (string), type (text, email, number, date, select, textarea, checkbox, radio), and optional: required (boolean), placeholder (string), options (for select/radio: array of {label, value}), defaultValue.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Field name (used as key in submitted data)' },
              label: { type: 'string', description: 'Display label' },
              type: {
                type: 'string',
                description: 'Field type: text, email, number, date, select, textarea, checkbox, radio',
              },
              required: { type: 'boolean' },
              placeholder: { type: 'string' },
              options: {
                type: 'array',
                description: 'Options for select or radio fields',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    value: { type: 'string' },
                  },
                  required: ['label', 'value'],
                },
              },
              defaultValue: { description: 'Default value for the field' },
            },
            required: ['name', 'label', 'type'],
          },
        },
        submitLabel: {
          type: 'string',
          description: 'Label for the submit button (default: "Submit")',
        },
        description: {
          type: 'string',
          description: 'Optional description text shown below the title in the form',
        },
        timeoutSeconds: {
          type: 'number',
          description: 'How long to wait for a response in seconds (default: 300 = 5 minutes, max: 3600)',
        },
      },
      required: ['title', 'message', 'fields'],
    },
  },
  {
    name: 'interact_with_user',
    description:
      'Creates any interactive canvas UI, sends the URL to the user, and waits for their interaction. ' +
      'This is the most flexible tool — use it whenever a visual UI would be better than text. ' +
      'YOU SHOULD USE THIS TOOL whenever you need to: ' +
      '(1) show the user something visual (charts, dashboards, data tables), ' +
      '(2) collect user input or decisions (forms, approvals, selections), ' +
      '(3) play a game or run an interactive experience (checkers, trivia, polls), ' +
      '(4) present information that benefits from rich formatting (markdown, alerts, cards), ' +
      '(5) build any custom UI using the canvas component system. ' +
      'Provide a full canvas descriptor with components. Available component types: ' +
      'LAYOUT: container, row, column, grid, stack, tabs, accordion. ' +
      'TEXT: text, heading, markdown, code. ' +
      'DATA: table, list, key-value, tree, card, tag, stat. ' +
      'CHARTS: chart (line, bar, pie, doughnut, area, scatter, radar). ' +
      'FORMS: input, textarea, select, multiselect, checkbox, radio, slider, toggle, button, button-group, form. ' +
      'RICH: progress, badge, image, link, divider, spacer, alert, callout, embed. ' +
      'Components support click/change/submit events via the events array. ' +
      'The tool polls for user interaction events and returns them. ' +
      'Use waitForEventTypes to specify which events signal completion (default: ["submit"]). ' +
      'For ongoing interactions (games, multi-step flows), call this tool repeatedly — ' +
      'update the canvas between calls using update_canvas/update_component.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Canvas title (shown in the canvas list and tab)',
        },
        message: {
          type: 'string',
          description: 'Message sent to the user via the outbound webhook explaining what to do. Include context about what the UI is for.',
        },
        components: {
          type: 'array',
          description:
            'Array of root-level component descriptors. Each component has: id (string), type (string), ' +
            'props (object, type-specific), children (array of child components, optional), ' +
            'events (array of {type: "click"|"change"|"submit", action: {type: "dispatch"}}, optional), ' +
            'style (CSS overrides, optional). Nest components to build complex layouts.',
        },
        waitForEventTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Event types that signal the interaction is complete (default: ["submit"]). ' +
            'Use ["click"] for button-based UIs, ["submit"] for forms, ["click","change"] for interactive dashboards.',
        },
        timeoutSeconds: {
          type: 'number',
          description: 'How long to wait for interaction in seconds (default: 300 = 5 minutes, max: 3600)',
        },
        notifyUser: {
          type: 'boolean',
          description: 'Whether to send the URL via the outbound webhook (default: true). Set false if the user already has the URL.',
        },
      },
      required: ['title', 'message', 'components'],
    },
  },
];

// Handle tool list requests
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Exported for testing — handles a single tool call
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    switch (name) {
      case 'list_canvases': {
        const canvases = await apiCall<CanvasSummary[]>('/canvases');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(canvases, null, 2),
            },
          ],
        };
      }

      case 'create_canvas': {
        const { descriptor } = args as { descriptor: { title: string; components: unknown[] } };
        validateObject(descriptor, 'descriptor', true);
        validateString(descriptor.title, 'descriptor.title', true);
        validateArray(descriptor.components, 'descriptor.components', true);

        const canvas = await apiCall<Canvas>('/canvases', {
          method: 'POST',
          body: JSON.stringify(descriptor),
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(canvas, null, 2),
            },
          ],
        };
      }

      case 'get_canvas': {
        const { id } = args as { id: string };
        validateString(id, 'id', true);

        const canvas = await apiCall<Canvas>(`/canvases/${id}`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(canvas, null, 2),
            },
          ],
        };
      }

      case 'update_canvas': {
        const { id, descriptor, state, components } = args as {
          id: string;
          descriptor?: object;
          state?: object;
          components?: Array<{ id: string; props?: object; state?: object }>;
        };
        validateString(id, 'id', true);

        if (descriptor !== undefined) {
          validateObject(descriptor, 'descriptor', false);
        }
        if (state !== undefined) {
          validateObject(state, 'state', false);
        }
        if (components !== undefined) {
          validateArray(components, 'components', false);
        }

        if (descriptor === undefined && state === undefined && components === undefined) {
          throw new ValidationError(
            'At least one field must be provided to update (descriptor, state, or components)'
          );
        }

        const body: Record<string, unknown> = {};
        if (descriptor !== undefined) body.descriptor = descriptor;
        if (state !== undefined) body.state = state;
        if (components !== undefined) body.components = components;

        const canvas = await apiCall<Canvas>(`/canvases/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(canvas, null, 2),
            },
          ],
        };
      }

      case 'delete_canvas': {
        const { id } = args as { id: string };
        validateString(id, 'id', true);

        const result = await apiCall<{ deleted: boolean; id: string }>(`/canvases/${id}`, {
          method: 'DELETE',
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_canvas_url': {
        const { id } = args as { id: string };
        validateString(id, 'id', true);

        // Verify the canvas exists first
        await apiCall<Canvas>(`/canvases/${id}`);

        const url = `${CANVAS_WEB_APP_URL}?canvasId=${id}`;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ id, url, note: 'Open this URL in a browser to view the canvas. The Canvas Web App (port 5174) must be running.' }, null, 2),
            },
          ],
        };
      }

      case 'get_canvas_state': {
        const { id } = args as { id: string };
        validateString(id, 'id', true);

        const state = await apiCall<CanvasStateSnapshot>(`/canvases/${id}/state`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(state, null, 2),
            },
          ],
        };
      }

      case 'get_component_state': {
        const { canvasId, componentId } = args as { canvasId: string; componentId: string };
        validateString(canvasId, 'canvasId', true);
        validateString(componentId, 'componentId', true);

        const state = await apiCall<ComponentState>(`/canvases/${canvasId}/state/${componentId}`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(state, null, 2),
            },
          ],
        };
      }

      case 'add_component': {
        const { canvasId, component, parentId, position } = args as {
          canvasId: string;
          component: object;
          parentId?: string;
          position?: number;
        };
        validateString(canvasId, 'canvasId', true);
        validateObject(component, 'component', true);
        if (parentId !== undefined) validateString(parentId, 'parentId', false);
        if (position !== undefined) validateNumber(position, 'position', false);

        const body: Record<string, unknown> = { component };
        if (parentId !== undefined) body.parentId = parentId;
        if (position !== undefined) body.position = position;

        const result = await apiCall<{ added: object; canvas: Canvas }>(
          `/canvases/${canvasId}/components`,
          {
            method: 'POST',
            body: JSON.stringify(body),
          }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'update_component': {
        const { canvasId, componentId, props, style, children, events } = args as {
          canvasId: string;
          componentId: string;
          props?: object;
          style?: object;
          children?: unknown[];
          events?: unknown[];
        };
        validateString(canvasId, 'canvasId', true);
        validateString(componentId, 'componentId', true);

        if (props !== undefined) validateObject(props, 'props', false);
        if (style !== undefined) validateObject(style, 'style', false);
        if (children !== undefined) validateArray(children, 'children', false);
        if (events !== undefined) validateArray(events, 'events', false);

        if (props === undefined && style === undefined && children === undefined && events === undefined) {
          throw new ValidationError(
            'At least one field must be provided to update (props, style, children, or events)'
          );
        }

        const body: Record<string, unknown> = {};
        if (props !== undefined) body.props = props;
        if (style !== undefined) body.style = style;
        if (children !== undefined) body.children = children;
        if (events !== undefined) body.events = events;

        const result = await apiCall<{ updated: object; canvas: Canvas }>(
          `/canvases/${canvasId}/components/${componentId}`,
          {
            method: 'PATCH',
            body: JSON.stringify(body),
          }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'remove_component': {
        const { canvasId, componentId } = args as {
          canvasId: string;
          componentId: string;
        };
        validateString(canvasId, 'canvasId', true);
        validateString(componentId, 'componentId', true);

        const result = await apiCall<{ removed: object; canvas: Canvas }>(
          `/canvases/${canvasId}/components/${componentId}`,
          {
            method: 'DELETE',
          }
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'post_action': {
        const { canvasId, componentId, eventType, value, metadata } = args as {
          canvasId: string;
          componentId: string;
          eventType: string;
          value?: unknown;
          metadata?: object;
        };
        validateString(canvasId, 'canvasId', true);
        validateString(componentId, 'componentId', true);
        validateString(eventType, 'eventType', true);
        if (metadata !== undefined) {
          validateObject(metadata, 'metadata', false);
        }

        const body: Record<string, unknown> = { componentId, eventType };
        if (value !== undefined) body.value = value;
        if (metadata !== undefined) body.metadata = metadata;

        const event = await apiCall<CanvasEvent>(`/canvases/${canvasId}/actions`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(event, null, 2),
            },
          ],
        };
      }

      case 'get_events': {
        const { canvasId, componentId, eventType, limit, offset } = args as {
          canvasId: string;
          componentId?: string;
          eventType?: string;
          limit?: number;
          offset?: number;
        };
        validateString(canvasId, 'canvasId', true);
        if (componentId !== undefined) validateString(componentId, 'componentId', false);
        if (eventType !== undefined) validateString(eventType, 'eventType', false);
        if (limit !== undefined) validateNumber(limit, 'limit', false);
        if (offset !== undefined) validateNumber(offset, 'offset', false);

        const params = new URLSearchParams();
        if (componentId) params.set('componentId', componentId);
        if (eventType) params.set('eventType', eventType);
        if (limit !== undefined) params.set('limit', String(limit));
        if (offset !== undefined) params.set('offset', String(offset));

        const query = params.toString();
        const endpoint = `/canvases/${canvasId}/events${query ? `?${query}` : ''}`;
        const events = await apiCall<EventsResponse>(endpoint);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(events, null, 2),
            },
          ],
        };
      }

      case 'get_pending_events': {
        const { canvasId, componentId, eventType, limit, offset } = args as {
          canvasId: string;
          componentId?: string;
          eventType?: string;
          limit?: number;
          offset?: number;
        };
        validateString(canvasId, 'canvasId', true);
        if (componentId !== undefined) validateString(componentId, 'componentId', false);
        if (eventType !== undefined) validateString(eventType, 'eventType', false);
        if (limit !== undefined) validateNumber(limit, 'limit', false);
        if (offset !== undefined) validateNumber(offset, 'offset', false);

        const params = new URLSearchParams();
        if (componentId) params.set('componentId', componentId);
        if (eventType) params.set('eventType', eventType);
        if (limit !== undefined) params.set('limit', String(limit));
        if (offset !== undefined) params.set('offset', String(offset));

        const query = params.toString();
        const endpoint = `/canvases/${canvasId}/events/pending${query ? `?${query}` : ''}`;
        const pendingEvents = await apiCall<PendingEventsResponse>(endpoint);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(pendingEvents, null, 2),
            },
          ],
        };
      }

      case 'acknowledge_event': {
        const { canvasId, eventId, eventIds } = args as {
          canvasId: string;
          eventId?: string;
          eventIds?: string[];
        };
        validateString(canvasId, 'canvasId', true);

        if (eventId === undefined && eventIds === undefined) {
          throw new ValidationError('Either eventId or eventIds must be provided');
        }
        if (eventId !== undefined && eventIds !== undefined) {
          throw new ValidationError('Provide either eventId or eventIds, not both');
        }

        if (eventId !== undefined) {
          validateString(eventId, 'eventId', true);
          const result = await apiCall<AcknowledgeResponse>(
            `/canvases/${canvasId}/events/${eventId}/acknowledge`,
            { method: 'POST' }
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } else {
          validateArray(eventIds, 'eventIds', true);
          const result = await apiCall<AcknowledgeResponse>(
            `/canvases/${canvasId}/events/acknowledge`,
            {
              method: 'POST',
              body: JSON.stringify({ eventIds }),
            }
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }
      }

      case 'subscribe_to_events': {
        const { canvasId, componentIds, eventTypes } = args as {
          canvasId: string;
          componentIds?: string[];
          eventTypes?: string[];
        };
        validateString(canvasId, 'canvasId', true);
        if (componentIds !== undefined) validateArray(componentIds, 'componentIds', false);
        if (eventTypes !== undefined) validateArray(eventTypes, 'eventTypes', false);

        // Fetch pending events, applying filters one at a time and merging results
        // For multiple componentIds or eventTypes, we make separate calls and merge
        const allEvents: CanvasEvent[] = [];
        const seenIds = new Set<string>();

        if (componentIds && componentIds.length > 0) {
          for (const cid of componentIds) {
            const params = new URLSearchParams();
            params.set('componentId', cid);
            const result = await apiCall<PendingEventsResponse>(
              `/canvases/${canvasId}/events/pending?${params.toString()}`
            );
            for (const evt of result.events) {
              if (!seenIds.has(evt.id)) {
                // If eventTypes filter is also set, apply it
                if (eventTypes && eventTypes.length > 0) {
                  if (eventTypes.includes(evt.event_type)) {
                    seenIds.add(evt.id);
                    allEvents.push(evt);
                  }
                } else {
                  seenIds.add(evt.id);
                  allEvents.push(evt);
                }
              }
            }
          }
        } else if (eventTypes && eventTypes.length > 0) {
          for (const et of eventTypes) {
            const params = new URLSearchParams();
            params.set('eventType', et);
            const result = await apiCall<PendingEventsResponse>(
              `/canvases/${canvasId}/events/pending?${params.toString()}`
            );
            for (const evt of result.events) {
              if (!seenIds.has(evt.id)) {
                seenIds.add(evt.id);
                allEvents.push(evt);
              }
            }
          }
        } else {
          // No filters — return all pending events
          const result = await apiCall<PendingEventsResponse>(
            `/canvases/${canvasId}/events/pending`
          );
          allEvents.push(...result.events);
        }

        // Sort by created_at ascending
        allEvents.sort((a, b) => {
          const ta = a.created_at || '';
          const tb = b.created_at || '';
          return ta < tb ? -1 : ta > tb ? 1 : 0;
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                events: allEvents,
                total: allEvents.length,
                filters: {
                  componentIds: componentIds || [],
                  eventTypes: eventTypes || [],
                },
              }, null, 2),
            },
          ],
        };
      }

      // --- Convenience Tools ---

      case 'show_chart': {
        const { title, chartType, labels, datasets, height, options: chartOptions } = args as {
          title: string;
          chartType: string;
          labels: string[];
          datasets: Array<{
            label: string;
            data: number[];
            borderColor?: string;
            backgroundColor?: unknown;
            fill?: boolean;
            borderWidth?: number;
          }>;
          height?: string;
          options?: object;
        };
        validateString(title, 'title', true);
        validateString(chartType, 'chartType', true);
        validateArray(labels, 'labels', true);
        validateArray(datasets, 'datasets', true);
        if (height !== undefined) validateString(height, 'height', false);
        if (chartOptions !== undefined) validateObject(chartOptions, 'options', false);

        const descriptor = {
          title,
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
                  props: { content: title, level: 2 },
                },
                {
                  id: 'chart',
                  type: 'chart',
                  props: {
                    chartType,
                    height: height || '400px',
                    data: { labels, datasets },
                    ...(chartOptions ? { options: chartOptions } : {}),
                  },
                },
              ],
            },
          ],
        };

        const canvas = await apiCall<Canvas>('/canvases', {
          method: 'POST',
          body: JSON.stringify(descriptor),
        });

        const url = `${CANVAS_WEB_APP_URL}?canvasId=${canvas.id}`;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ id: canvas.id, title: canvas.title, url, created_at: canvas.created_at }, null, 2),
            },
          ],
        };
      }

      case 'show_table': {
        const { title, columns, data, sortable, filterable, pageSize } = args as {
          title: string;
          columns: Array<{ key: string; label: string; sortable?: boolean; filterable?: boolean; width?: string }>;
          data: object[];
          sortable?: boolean;
          filterable?: boolean;
          pageSize?: number;
        };
        validateString(title, 'title', true);
        validateArray(columns, 'columns', true);
        validateArray(data, 'data', true);
        if (sortable !== undefined && typeof sortable !== 'boolean') {
          throw new ValidationError("Field 'sortable' must be a boolean");
        }
        if (filterable !== undefined && typeof filterable !== 'boolean') {
          throw new ValidationError("Field 'filterable' must be a boolean");
        }
        if (pageSize !== undefined) validateNumber(pageSize, 'pageSize', false);

        const tableProps: Record<string, unknown> = {
          columns,
          data,
          sortable: sortable !== undefined ? sortable : true,
        };
        if (filterable) tableProps.filterable = true;
        if (pageSize !== undefined) {
          tableProps.pagination = { pageSize, showPageInfo: true };
        }

        const descriptor = {
          title,
          components: [
            {
              id: 'root',
              type: 'container',
              props: { direction: 'column', gap: '16px' },
              style: { padding: { all: '24px' } },
              children: [
                {
                  id: 'table-title',
                  type: 'heading',
                  props: { content: title, level: 2 },
                },
                {
                  id: 'table',
                  type: 'table',
                  props: tableProps,
                },
              ],
            },
          ],
        };

        const canvas = await apiCall<Canvas>('/canvases', {
          method: 'POST',
          body: JSON.stringify(descriptor),
        });

        const url = `${CANVAS_WEB_APP_URL}?canvasId=${canvas.id}`;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: canvas.id,
                title: canvas.title,
                url,
                rowCount: data.length,
                columnCount: columns.length,
                created_at: canvas.created_at,
              }, null, 2),
            },
          ],
        };
      }

      case 'show_form': {
        const { title, fields, submitLabel, description } = args as {
          title: string;
          fields: Array<{
            name: string;
            label: string;
            type: string;
            required?: boolean;
            placeholder?: string;
            options?: Array<{ label: string; value: string }>;
            defaultValue?: unknown;
            validation?: object;
          }>;
          submitLabel?: string;
          description?: string;
        };
        validateString(title, 'title', true);
        validateArray(fields, 'fields', true);
        if (submitLabel !== undefined) validateString(submitLabel, 'submitLabel', false);
        if (description !== undefined) validateString(description, 'description', false);

        // Build form children from field definitions
        const formChildren: object[] = [];

        for (const field of fields) {
          validateString(field.name, 'field.name', true);
          validateString(field.label, 'field.label', true);
          validateString(field.type, 'field.type', true);

          const fieldType = field.type.toLowerCase();

          if (fieldType === 'select') {
            validateArray(field.options, `field '${field.name}' options`, true);
            formChildren.push({
              id: `field-${field.name}`,
              type: 'select',
              props: {
                name: field.name,
                label: field.label,
                options: field.options,
                ...(field.required ? { required: true } : {}),
                ...(field.placeholder ? { placeholder: field.placeholder } : {}),
                ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
              },
            });
          } else if (fieldType === 'textarea') {
            formChildren.push({
              id: `field-${field.name}`,
              type: 'textarea',
              props: {
                name: field.name,
                label: field.label,
                rows: 4,
                ...(field.required ? { required: true } : {}),
                ...(field.placeholder ? { placeholder: field.placeholder } : {}),
                ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
                ...(field.validation ? { validation: field.validation } : {}),
              },
            });
          } else if (fieldType === 'checkbox') {
            formChildren.push({
              id: `field-${field.name}`,
              type: 'checkbox',
              props: {
                name: field.name,
                label: field.label,
                ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
              },
            });
          } else if (fieldType === 'radio') {
            validateArray(field.options, `field '${field.name}' options`, true);
            formChildren.push({
              id: `field-${field.name}`,
              type: 'radio',
              props: {
                name: field.name,
                label: field.label,
                options: field.options,
                ...(field.required ? { required: true } : {}),
                ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
              },
            });
          } else {
            // Standard input types: text, email, password, number, date, etc.
            formChildren.push({
              id: `field-${field.name}`,
              type: 'input',
              props: {
                name: field.name,
                label: field.label,
                inputType: fieldType,
                ...(field.required ? { required: true } : {}),
                ...(field.placeholder ? { placeholder: field.placeholder } : {}),
                ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
                ...(field.validation ? { validation: field.validation } : {}),
              },
            });
          }
        }

        // Add submit button
        formChildren.push({
          id: 'submit-btn',
          type: 'button',
          props: {
            label: submitLabel || 'Submit',
            variant: 'primary',
            fullWidth: true,
          },
        });

        const rootChildren: object[] = [
          {
            id: 'form-title',
            type: 'heading',
            props: { content: title, level: 2 },
          },
        ];

        if (description) {
          rootChildren.push({
            id: 'form-description',
            type: 'text',
            props: { content: description, variant: 'body1' },
            style: { color: '#64748b' },
          });
        }

        rootChildren.push({
          id: 'form',
          type: 'form',
          props: {
            onSubmit: {
              type: 'callback',
              callbackId: 'form-submit',
              payload: {},
            },
            validateOnBlur: true,
          },
          children: formChildren,
        });

        const descriptor = {
          title,
          components: [
            {
              id: 'root',
              type: 'container',
              props: { direction: 'column', gap: '16px' },
              style: { padding: { all: '24px' }, maxWidth: '600px', margin: { left: 'auto', right: 'auto' } },
              children: rootChildren,
            },
          ],
        };

        const canvas = await apiCall<Canvas>('/canvases', {
          method: 'POST',
          body: JSON.stringify(descriptor),
        });

        const url = `${CANVAS_WEB_APP_URL}?canvasId=${canvas.id}`;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: canvas.id,
                title: canvas.title,
                url,
                fieldCount: fields.length,
                created_at: canvas.created_at,
                note: 'Use get_pending_events with this canvas ID to retrieve form submissions.',
              }, null, 2),
            },
          ],
        };
      }

      case 'show_message': {
        const { title, content, style: msgStyle } = args as {
          title: string;
          content: string;
          style?: string;
        };
        validateString(title, 'title', true);
        validateString(content, 'content', true);
        if (msgStyle !== undefined) validateString(msgStyle, 'style', false);

        const resolvedStyle = msgStyle || 'info';
        const rootChildren: object[] = [
          {
            id: 'msg-title',
            type: 'heading',
            props: { content: title, level: 2 },
          },
        ];

        if (resolvedStyle === 'markdown') {
          rootChildren.push({
            id: 'message',
            type: 'markdown',
            props: { content },
          });
        } else {
          // Use alert component for info/warning/error/success
          rootChildren.push({
            id: 'message',
            type: 'alert',
            props: {
              content,
              variant: resolvedStyle,
            },
          });
        }

        const descriptor = {
          title,
          components: [
            {
              id: 'root',
              type: 'container',
              props: { direction: 'column', gap: '16px' },
              style: { padding: { all: '24px' }, maxWidth: '700px', margin: { left: 'auto', right: 'auto' } },
              children: rootChildren,
            },
          ],
        };

        const canvas = await apiCall<Canvas>('/canvases', {
          method: 'POST',
          body: JSON.stringify(descriptor),
        });

        const url = `${CANVAS_WEB_APP_URL}?canvasId=${canvas.id}`;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ id: canvas.id, title: canvas.title, url, style: resolvedStyle, created_at: canvas.created_at }, null, 2),
            },
          ],
        };
      }

      case 'request_user_input': {
        const { title, message, fields, submitLabel, description, timeoutSeconds } = args as {
          title: string;
          message: string;
          fields: Array<{
            name: string;
            label: string;
            type: string;
            required?: boolean;
            placeholder?: string;
            options?: Array<{ label: string; value: string }>;
            defaultValue?: unknown;
          }>;
          submitLabel?: string;
          description?: string;
          timeoutSeconds?: number;
        };
        validateString(title, 'title', true);
        validateString(message, 'message', true);
        validateArray(fields, 'fields', true);

        const timeout = Math.min(timeoutSeconds ?? 300, 3600) * 1000;

        // Build form children from field definitions (same logic as show_form)
        const formChildren: object[] = [];
        for (const field of fields) {
          validateString(field.name, 'field.name', true);
          validateString(field.label, 'field.label', true);
          validateString(field.type, 'field.type', true);
          const fieldType = field.type.toLowerCase();

          if (fieldType === 'select') {
            formChildren.push({
              id: `field-${field.name}`,
              type: 'select',
              props: {
                name: field.name,
                label: field.label,
                options: field.options,
                ...(field.required ? { required: true } : {}),
                ...(field.placeholder ? { placeholder: field.placeholder } : {}),
                ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
              },
            });
          } else if (fieldType === 'textarea') {
            formChildren.push({
              id: `field-${field.name}`,
              type: 'textarea',
              props: {
                name: field.name,
                label: field.label,
                rows: 4,
                ...(field.required ? { required: true } : {}),
                ...(field.placeholder ? { placeholder: field.placeholder } : {}),
                ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
              },
            });
          } else if (fieldType === 'checkbox') {
            formChildren.push({
              id: `field-${field.name}`,
              type: 'checkbox',
              props: {
                name: field.name,
                label: field.label,
                ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
              },
            });
          } else if (fieldType === 'radio') {
            formChildren.push({
              id: `field-${field.name}`,
              type: 'radio',
              props: {
                name: field.name,
                label: field.label,
                options: field.options,
                ...(field.required ? { required: true } : {}),
                ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
              },
            });
          } else {
            formChildren.push({
              id: `field-${field.name}`,
              type: 'input',
              props: {
                name: field.name,
                label: field.label,
                inputType: fieldType,
                ...(field.required ? { required: true } : {}),
                ...(field.placeholder ? { placeholder: field.placeholder } : {}),
                ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
              },
            });
          }
        }

        // Add submit button
        formChildren.push({
          id: 'submit-btn',
          type: 'button',
          props: {
            label: submitLabel || 'Submit',
            variant: 'primary',
            fullWidth: true,
            buttonType: 'submit',
          },
        });

        // Build root component tree
        const rootChildren: object[] = [
          { id: 'form-title', type: 'heading', props: { content: title, level: 2 } },
        ];
        if (description) {
          rootChildren.push({
            id: 'form-description',
            type: 'text',
            props: { content: description, variant: 'body1' },
            style: { color: '#64748b' },
          });
        }
        rootChildren.push({
          id: 'form',
          type: 'form',
          props: { validateOnBlur: true },
          events: [{ type: 'submit', action: { type: 'dispatch' } }],
          children: formChildren,
        });

        const canvasDescriptor = {
          title,
          components: [{
            id: 'root',
            type: 'container',
            props: { direction: 'column', gap: '16px' },
            style: { padding: { all: '24px' }, maxWidth: '600px', margin: { left: 'auto', right: 'auto' } },
            children: rootChildren,
          }],
        };

        // 1. Create the canvas
        const canvas = await apiCall<Canvas>('/canvases', {
          method: 'POST',
          body: JSON.stringify(canvasDescriptor),
        });

        const url = `${CANVAS_WEB_APP_URL}?canvasId=${canvas.id}`;

        // 2. Send URL to user via outbound webhook
        try {
          await fetch(OUTBOUND_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `${message}\n\n${url}`, source: 'canvas' }),
            signal: AbortSignal.timeout(10000),
          });
        } catch {
          // Webhook delivery failed — user can still access the URL if they have it
        }

        // 3. Check for already-pending submit events (race condition guard)
        let submitData: unknown = null;
        let timedOut = false;

        const pending = await apiCall<PendingEventsResponse>(
          `/canvases/${canvas.id}/events/pending`
        );
        const alreadyPending = pending.events.find(
          (e: any) => (e.event_type ?? e.eventType) === 'submit'
        );

        if (alreadyPending) {
          submitData = (alreadyPending.payload as Record<string, unknown>)?.value ?? alreadyPending.payload;
          await apiCall<AcknowledgeResponse>(
            `/canvases/${canvas.id}/events/${alreadyPending.id}/acknowledge`,
            { method: 'POST' }
          );
        } else {
          // 4. Wait for submit event via WebSocket
          const wsResult = await waitForCanvasEvent({
            canvasId: canvas.id,
            eventType: 'submit',
            timeoutMs: timeout,
          });

          if (wsResult) {
            // Fetch full event payload from API (WebSocket broadcast may not include all fields)
            try {
              const eventDetail = await apiCall<{ events: CanvasEvent[]; total: number }>(
                `/canvases/${canvas.id}/events?limit=1&offset=0`
              );
              const latestSubmit = eventDetail.events?.find(
                (e: any) => e.id === wsResult.eventId
              );
              submitData = latestSubmit
                ? (latestSubmit.payload as Record<string, unknown>)?.value ?? latestSubmit.payload
                : wsResult.payload ?? wsResult.value;
            } catch {
              submitData = wsResult.payload ?? wsResult.value;
            }
            // Acknowledge the event
            await apiCall<AcknowledgeResponse>(
              `/canvases/${canvas.id}/events/${wsResult.eventId}/acknowledge`,
              { method: 'POST' }
            );
          } else {
            timedOut = true;
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              canvasId: canvas.id,
              url,
              timedOut,
              response: submitData,
            }, null, 2),
          }],
        };
      }

      case 'interact_with_user': {
        const {
          title: iTitle,
          message: iMessage,
          components: iComponents,
          waitForEventTypes,
          timeoutSeconds: iTimeout,
          notifyUser,
        } = args as {
          title: string;
          message: string;
          components: unknown[];
          waitForEventTypes?: string[];
          timeoutSeconds?: number;
          notifyUser?: boolean;
        };
        validateString(iTitle, 'title', true);
        validateString(iMessage, 'message', true);
        validateArray(iComponents, 'components', true);

        const iTimeoutMs = Math.min(iTimeout ?? 300, 3600) * 1000;
        const targetEvents = waitForEventTypes ?? ['submit'];
        const shouldNotify = notifyUser !== false;

        // 1. Create the canvas
        const iCanvas = await apiCall<Canvas>('/canvases', {
          method: 'POST',
          body: JSON.stringify({ title: iTitle, components: iComponents }),
        });

        const iUrl = `${CANVAS_WEB_APP_URL}?canvasId=${iCanvas.id}`;

        // 2. Optionally send URL to user via outbound webhook
        if (shouldNotify) {
          try {
            await fetch(OUTBOUND_WEBHOOK_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: `${iMessage}\n\n${iUrl}`, source: 'canvas' }),
              signal: AbortSignal.timeout(10000),
            });
          } catch {
            // Webhook delivery failed — continue anyway
          }
        }

        // 3. Check for already-pending matching events (race condition guard)
        let matchedEvent: Record<string, unknown> | null = null;

        const iPending = await apiCall<PendingEventsResponse>(
          `/canvases/${iCanvas.id}/events/pending`
        );
        const alreadyFound = iPending.events.find(
          (e: any) => targetEvents.includes(e.event_type ?? e.eventType)
        );

        if (alreadyFound) {
          matchedEvent = alreadyFound as unknown as Record<string, unknown>;
          await apiCall<AcknowledgeResponse>(
            `/canvases/${iCanvas.id}/events/${alreadyFound.id}/acknowledge`,
            { method: 'POST' }
          );
        } else {
          // 4. Wait for event via WebSocket
          // For multiple target event types, we can't filter by a single eventType,
          // so we listen for any event and filter in the result
          const wsEventType = targetEvents.length === 1 ? targetEvents[0] : undefined;
          const wsResult = await waitForCanvasEvent({
            canvasId: iCanvas.id,
            eventType: wsEventType,
            timeoutMs: iTimeoutMs,
          });

          if (wsResult) {
            // If multiple target types, verify the match
            if (!wsEventType && !targetEvents.includes(wsResult.eventType)) {
              // Didn't match — treat as timeout (edge case)
            } else {
              // Fetch the full event from the API for complete payload
              try {
                const pendingCheck = await apiCall<PendingEventsResponse>(
                  `/canvases/${iCanvas.id}/events/pending`
                );
                const fullEvent = pendingCheck.events.find((e: any) => e.id === wsResult.eventId);
                if (fullEvent) {
                  matchedEvent = fullEvent as unknown as Record<string, unknown>;
                } else {
                  // Event may have been auto-acked; construct from WS data
                  matchedEvent = {
                    id: wsResult.eventId,
                    event_type: wsResult.eventType,
                    payload: {
                      componentId: wsResult.componentId,
                      value: wsResult.value,
                    },
                  };
                }
              } catch {
                matchedEvent = {
                  id: wsResult.eventId,
                  event_type: wsResult.eventType,
                  payload: {
                    componentId: wsResult.componentId,
                    value: wsResult.value,
                  },
                };
              }
              // Acknowledge
              await apiCall<AcknowledgeResponse>(
                `/canvases/${iCanvas.id}/events/${wsResult.eventId}/acknowledge`,
                { method: 'POST' }
              );
            }
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              canvasId: iCanvas.id,
              url: iUrl,
              timedOut: !matchedEvent,
              event: matchedEvent ? {
                eventType: (matchedEvent as any).event_type ?? (matchedEvent as any).eventType,
                componentId: ((matchedEvent as any).payload as Record<string, unknown>)?.componentId,
                value: ((matchedEvent as any).payload as Record<string, unknown>)?.value,
                metadata: ((matchedEvent as any).payload as Record<string, unknown>)?.metadata ?? null,
              } : null,
            }, null, 2),
          }],
        };
      }

      case 'wait_for_event': {
        const {
          canvasId: weCanvasId,
          componentId: weComponentId,
          eventType: weEventType,
          timeoutSeconds: weTimeout,
          acknowledge: weAck,
        } = args as {
          canvasId: string;
          componentId?: string;
          eventType?: string;
          timeoutSeconds?: number;
          acknowledge?: boolean;
        };
        validateString(weCanvasId, 'canvasId', true);

        const weTimeoutMs = Math.min(weTimeout ?? 300, 3600) * 1000;
        const shouldAck = weAck !== false;
        let weMatch: Record<string, unknown> | null = null;

        // 1. Check for already-pending events first (race condition guard)
        const wePending = await apiCall<PendingEventsResponse>(
          `/canvases/${weCanvasId}/events/pending`
        );

        const alreadyPending = wePending.events.find((e: any) => {
          const eType = e.event_type ?? e.eventType;
          const eCompId = e.payload?.componentId;
          if (weEventType && eType !== weEventType) return false;
          if (weComponentId && eCompId !== weComponentId) return false;
          return true;
        });

        if (alreadyPending) {
          weMatch = alreadyPending as unknown as Record<string, unknown>;
        } else {
          // 2. Wait for event via WebSocket
          const wsResult = await waitForCanvasEvent({
            canvasId: weCanvasId,
            componentId: weComponentId,
            eventType: weEventType,
            timeoutMs: weTimeoutMs,
          });

          if (wsResult) {
            // Fetch the full event from the pending events API for complete payload
            try {
              const postWsPending = await apiCall<PendingEventsResponse>(
                `/canvases/${weCanvasId}/events/pending`
              );
              const fullEvent = postWsPending.events.find((e: any) => e.id === wsResult.eventId);
              if (fullEvent) {
                weMatch = fullEvent as unknown as Record<string, unknown>;
              } else {
                // Construct from WebSocket data
                weMatch = {
                  id: wsResult.eventId,
                  event_type: wsResult.eventType,
                  payload: {
                    componentId: wsResult.componentId,
                    value: wsResult.value,
                  },
                };
              }
            } catch {
              weMatch = {
                id: wsResult.eventId,
                event_type: wsResult.eventType,
                payload: {
                  componentId: wsResult.componentId,
                  value: wsResult.value,
                },
              };
            }
          }
        }

        // 3. Acknowledge if matched
        if (weMatch && shouldAck) {
          await apiCall<AcknowledgeResponse>(
            `/canvases/${weCanvasId}/events/${(weMatch as any).id}/acknowledge`,
            { method: 'POST' }
          );
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              canvasId: weCanvasId,
              timedOut: !weMatch,
              event: weMatch ? {
                eventId: (weMatch as any).id,
                eventType: (weMatch as any).event_type ?? (weMatch as any).eventType,
                componentId: ((weMatch as any).payload as Record<string, unknown>)?.componentId,
                value: ((weMatch as any).payload as Record<string, unknown>)?.value,
                metadata: ((weMatch as any).payload as Record<string, unknown>)?.metadata ?? null,
              } : null,
            }, null, 2),
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
}

// Handle tool execution requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleToolCall(name, args as Record<string, unknown>);
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Canvas MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
