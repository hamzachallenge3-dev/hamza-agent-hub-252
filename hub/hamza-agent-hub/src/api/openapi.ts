/**
 * OpenAPI description of the `/v1` surface.
 *
 * Generated from the same constants the router uses, so the document cannot
 * drift into describing routes that do not exist.
 */
import { CAPABILITIES } from '../runtime/capabilities.js';
import { PACKS } from '../runtime/registry.js';

const ERROR_SCHEMA = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        recovery: { type: 'string', nullable: true },
        status: { type: 'integer' },
      },
      required: ['code', 'message', 'status'],
    },
  },
};

function errorResponses(...codes: Array<[string, string]>) {
  return Object.fromEntries(
    codes.map(([code, description]) => [code, { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }])
  );
}

const PAGINATION_PARAMS = [
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 }, description: 'Page size.' },
  { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 }, description: 'Rows to skip.' },
];

export function openApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Hamza Agent Hub API',
      version: '1.2.1',
      description:
        'Agent discovery, mission orchestration, artifacts, browser sessions, integration and model readiness. ' +
        'Task state is reported twice: `state` is the explicit nine-value machine state, `status` is the legacy value kept for existing consumers.',
    },
    servers: [{ url: '/', description: 'This Hub instance' }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'HAH_AUTH_TOKEN' } },
      schemas: {
        Error: ERROR_SCHEMA,
        TaskState: {
          type: 'string',
          enum: [
            'QUEUED',
            'RUNNING',
            'WAITING_FOR_DEPENDENCY',
            'WAITING_FOR_APPROVAL',
            'COMPLETED_VERIFIED',
            'COMPLETED_LIMITED',
            'BLOCKED',
            'FAILED',
            'CANCELLED',
          ],
        },
        Readiness: { type: 'string', enum: ['READY', 'LIMITED', 'BLOCKED', 'UNTESTED'] },
        Capability: { type: 'string', enum: [...CAPABILITIES] },
        Agent: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            pack: { type: 'string', enum: PACKS.map((p) => p.id) },
            category: { type: 'string' },
            description: { type: 'string' },
            capabilities: { type: 'array', items: { $ref: '#/components/schemas/Capability' } },
            readiness: { $ref: '#/components/schemas/Readiness' },
            readiness_reason: { type: 'string' },
            requires_model: { type: 'boolean' },
            tested: { type: 'boolean' },
          },
        },
        Mission: {
          type: 'object',
          properties: {
            task_id: { type: 'string' },
            agent_id: { type: 'string' },
            workspace_id: { type: 'string' },
            state: { $ref: '#/components/schemas/TaskState' },
            status: { type: 'string', description: 'Legacy status for backward compatibility.' },
            verified: { type: 'boolean', description: 'True only when the run produced checkable evidence.' },
            progress: { type: 'number' },
            attempts: { type: 'integer' },
            error: { type: 'string', nullable: true },
            artifacts: { type: 'array', items: { type: 'string' } },
            mission_id: { type: 'string', description: 'Present on an orchestrated mission.' },
            active_agent: { type: 'string', nullable: true, description: 'The subtask currently executing.' },
            unassigned: {
              type: 'integer',
              description: 'Planned subtasks no assignable agent could take. They were not run.',
            },
            subtasks: {
              type: 'array',
              description:
                'One entry per queued subtask. A mission is only as complete as its least complete subtask, ' +
                'and only verified when every subtask is.',
              items: { $ref: '#/components/schemas/Subtask' },
            },
          },
        },
        Subtask: {
          type: 'object',
          properties: {
            task_id: { type: 'string' },
            role: { type: 'string' },
            capability: { type: 'string', nullable: true },
            agent_id: { type: 'string' },
            state: { $ref: '#/components/schemas/TaskState' },
            verified: { type: 'boolean' },
            depends_on: {
              type: 'array',
              items: { type: 'string' },
              description: 'Sibling task ids that must finish first. Until then the subtask is WAITING_FOR_DEPENDENCY.',
            },
            progress_message: { type: 'string' },
            error: { type: 'string', nullable: true },
            artifacts: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    paths: {
      '/health/live': {
        get: {
          summary: 'Liveness probe',
          security: [],
          responses: { '200': { description: 'The process is running.' } },
        },
      },
      '/health/ready': {
        get: {
          summary: 'Readiness probe',
          description:
            'Ready means the Hub can accept and run work. A missing live model degrades results to COMPLETED_LIMITED but does not make the Hub unready.',
          security: [],
          responses: { '200': { description: 'Ready.' }, '503': { description: 'Not ready; see checks.' } },
        },
      },
      '/v1/openapi.json': {
        get: { summary: 'This document', security: [], responses: { '200': { description: 'OpenAPI document.' } } },
      },
      '/v1/agents': {
        get: {
          summary: 'List agents with real capabilities and runtime readiness',
          parameters: [
            { name: 'pack', in: 'query', schema: { type: 'string', enum: PACKS.map((p) => p.id) } },
            { name: 'capability', in: 'query', schema: { $ref: '#/components/schemas/Capability' } },
            { name: 'readiness', in: 'query', schema: { $ref: '#/components/schemas/Readiness' } },
            ...PAGINATION_PARAMS,
          ],
          responses: {
            '200': {
              description: 'A page of agents.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      agents: { type: 'array', items: { $ref: '#/components/schemas/Agent' } },
                      total: { type: 'integer' },
                      offset: { type: 'integer' },
                      limit: { type: 'integer' },
                      has_more: { type: 'boolean' },
                    },
                  },
                },
              },
            },
            ...errorResponses(['400', 'Unknown pack, capability or readiness value.'], ['401', 'Missing or invalid bearer token.']),
          },
        },
      },
      '/v1/agents/{id}': {
        get: {
          summary: 'Inspect one agent, its capabilities, dependencies and readiness',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Agent detail.' }, ...errorResponses(['404', 'Unknown agent.']) },
        },
      },
      '/v1/capabilities': {
        get: {
          summary: 'Capability coverage across agents and integrations, including gaps',
          responses: { '200': { description: 'Capability coverage.' } },
        },
      },
      '/v1/tools': {
        get: { summary: 'Discover the MCP tool surface', responses: { '200': { description: 'Tool list.' } } },
      },
      '/v1/catalog': {
        get: {
          summary: 'Search the catalog (packs, agents, tools13, MCP tools)',
          parameters: [
            { name: 'query', in: 'query', schema: { type: 'string' } },
            { name: 'pack', in: 'query', schema: { type: 'string', enum: PACKS.map((p) => p.id) } },
            { name: 'capability', in: 'query', schema: { $ref: '#/components/schemas/Capability' } },
            { name: 'executable_only', in: 'query', schema: { type: 'boolean' } },
            ...PAGINATION_PARAMS,
          ],
          responses: { '200': { description: 'Catalog hits plus an honest inventory.' }, ...errorResponses(['400', 'Invalid filter.']) },
        },
      },
      '/v1/missions': {
        post: {
          summary: 'Submit a mission to the Boss, or run one named agent',
          description:
            'Omit agent_id to run the full Boss decomposition: one task per subtask, wired to the ' +
            'dependencies the plan declared and assembled into a single report. Name an agent_id to ' +
            'run that one agent only.',
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: true,
              schema: { type: 'string' },
              description: 'Stable key per mission. A retried POST returns the original mission rather than queuing a duplicate.',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['task'],
                  properties: {
                    task: { type: 'string' },
                    agent_id: {
                      type: 'string',
                      description: 'Run exactly this agent. Omit to orchestrate the whole decomposition.',
                    },
                    workspace_id: { type: 'string' },
                    idempotency_key: { type: 'string', description: 'Alternative to the header.' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Mission queued.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Mission' } } } },
            '200': { description: 'Existing mission returned for a repeated idempotency key.' },
            ...errorResponses(
              ['400', 'Missing task or idempotency key.'],
              ['404', 'Unknown agent.'],
              ['409', 'The agent is BLOCKED, or the key was reused with different task text.'],
              ['503', 'Queue is full.']
            ),
          },
        },
      },
      '/v1/missions/plan': {
        post: {
          summary: 'Preview the Boss plan without queuing anything',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['task'], properties: { task: { type: 'string' } } } } } },
          responses: { '200': { description: 'Plan with roles, dependencies, constraints and capability gaps.' }, ...errorResponses(['400', 'Missing task.']) },
        },
      },
      '/v1/missions/{id}': {
        get: {
          summary: 'Mission state',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Mission.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Mission' } } } },
            ...errorResponses(['404', 'Unknown mission.']),
          },
        },
      },
      '/v1/missions/{id}/result': {
        get: {
          summary: 'Mission output, evidence and tool log',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Result.' }, ...errorResponses(['404', 'Unknown mission.']) },
        },
      },
      '/v1/missions/{id}/events': {
        get: {
          summary: 'Mission event log, with optional streaming',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'stream', in: 'query', schema: { type: 'boolean' }, description: 'Set true for a text/event-stream of state changes.' },
            ...PAGINATION_PARAMS,
          ],
          responses: { '200': { description: 'Events.' }, ...errorResponses(['404', 'Unknown mission.']) },
        },
      },
      '/v1/missions/{id}/cancel': {
        post: {
          summary: 'Cancel a queued or running mission',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Cancelled.' }, ...errorResponses(['404', 'Unknown mission.']) },
        },
      },
      '/v1/artifacts/{taskId}': {
        get: {
          summary: 'List or download the artifacts a mission recorded',
          description: 'Only paths the mission itself recorded are served, resolved through the workspace sandbox.',
          parameters: [
            { name: 'taskId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'path', in: 'query', schema: { type: 'string' }, description: 'Omit to list; supply a recorded path to download.' },
          ],
          responses: {
            '200': { description: 'Artifact list or file contents.' },
            ...errorResponses(['400', 'Path escapes the workspace.'], ['404', 'Unknown mission or unrecorded artifact.'], ['410', 'Recorded but no longer on disk.']),
          },
        },
      },
      '/v1/integrations': {
        get: { summary: 'Integration identity, auth requirement, operations, readiness, limits and cost', responses: { '200': { description: 'Integration status.' } } },
      },
      '/v1/integrations/{id}': {
        get: {
          summary: 'Inspect one integration',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Integration detail.' }, ...errorResponses(['404', 'Unknown integration.']) },
        },
      },
      '/v1/model/health': {
        get: { summary: 'Per-provider model readiness', responses: { '200': { description: 'Model health.' } } },
      },
      '/v1/browser/sessions': {
        get: { summary: 'Browser runtime availability and open sessions', responses: { '200': { description: 'Sessions.' } } },
        post: {
          summary: 'Open a browser session scoped to an explicit domain allow list',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['allow_domains'],
                  properties: {
                    allow_domains: { type: 'array', items: { type: 'string' } },
                    deny_domains: { type: 'array', items: { type: 'string' } },
                    allow_actions: { type: 'array', items: { type: 'string' } },
                    allow_downloads: { type: 'boolean', default: false },
                    allow_uploads: { type: 'boolean', default: false },
                    profile: { type: 'string', description: 'Reuse a previously authorised encrypted login profile.' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Session opened.' }, ...errorResponses(['400', 'allow_domains missing.'], ['503', 'Browser runtime unavailable.']) },
        },
      },
      '/v1/browser/sessions/{id}': {
        delete: {
          summary: 'Close a browser session',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Closed.' }, ...errorResponses(['404', 'Unknown session.']) },
        },
      },
      '/v1/missions/{id}/approval': {
        get: {
          summary: 'Inspect the action a mission is waiting for a human to authorise',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Pending approval, or none.' }, ...errorResponses(['404', 'Unknown mission.']) },
        },
        post: {
          summary: 'Approve or decline the pending action',
          description:
            'Approving requeues the mission and authorises exactly one attempt of that action. Declining cancels it; work never continues past a refused action.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['approve', 'actor'],
                  properties: {
                    approve: { type: 'boolean' },
                    actor: { type: 'string', description: 'Who authorised this. An approval with no accountable actor is rejected.' },
                    note: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Decision recorded.' },
            ...errorResponses(['400', 'approve or actor missing.'], ['404', 'Unknown mission.'], ['409', 'Not awaiting approval.']),
          },
        },
      },
      '/v1/audit': {
        get: {
          summary: 'Per-agent audit: tools, verified tools, inputs, outputs, requirements, readiness and limitations',
          description:
            'Readiness is measured from executed tool smoke checks, not from the catalog `tested` flag. `declared_readiness` carries the structural classification so the two can be compared.',
          parameters: [
            { name: 'readiness', in: 'query', schema: { $ref: '#/components/schemas/Readiness' } },
            ...PAGINATION_PARAMS,
          ],
          responses: { '200': { description: 'Audit rows with a roster summary.' }, ...errorResponses(['400', 'Unknown readiness value.']) },
        },
      },
      '/v1/audit/{id}': {
        get: {
          summary: 'Audit one agent',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Audit row.' }, ...errorResponses(['404', 'Unknown agent.']) },
        },
      },
      '/v1/diagnostics': {
        get: { summary: 'System diagnostics: agent readiness, Tools13, model, browser, queue, integrations', responses: { '200': { description: 'Diagnostics.' } } },
      },
    },
  };
}
