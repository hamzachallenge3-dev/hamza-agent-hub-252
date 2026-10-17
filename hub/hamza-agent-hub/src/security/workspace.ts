import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export function ensureWorkspace(workspaceId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(workspaceId)) {
    throw new Error('invalid workspace_id');
  }
  const root = path.resolve(config.workspacesDir, workspaceId);
  const base = path.resolve(config.workspacesDir);
  fs.mkdirSync(base, { recursive: true });
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw new Error('workspace symlink blocked');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function resolveSafePath(workspaceRoot: string, relativePath: string): string {
  const cleaned = relativePath.replace(/\\/g, '/');
  if (cleaned.includes('\0') || cleaned.startsWith('/') || /^[a-zA-Z]:/.test(cleaned)) {
    throw new Error('path traversal blocked');
  }
  const resolved = path.resolve(workspaceRoot, cleaned);
  const root = path.resolve(workspaceRoot);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('path traversal blocked');
  }
  // Reject every existing symlink component, including links within the workspace.
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw new Error('workspace symlink blocked');
  let cursor = root;
  for (const segment of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('path symlink blocked');
  }
  return resolved;
}

export function assertToolAllowed(allowed: string[], toolName: string): void {
  if (!allowed.includes(toolName)) {
    throw new Error(`tool not permitted for this role: ${toolName}`);
  }
}
