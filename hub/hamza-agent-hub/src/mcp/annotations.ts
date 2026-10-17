import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/** ChatGPT / Codex directory requires readOnlyHint, openWorldHint, destructiveHint. */
export const RO: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
};

export const RO_OPEN: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
  idempotentHint: true,
};

export const WRITE_LOCAL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true, // Queued agents may call the configured free model gateway.
  idempotentHint: false,
};

export const CANCEL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
  idempotentHint: true,
};

/** Shell in the sandbox user workdir — secret-path HTTP only. */
export const SANDBOX_EXEC: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
  idempotentHint: false,
};
