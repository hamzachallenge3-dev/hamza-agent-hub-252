/**
 * Choose which automatic tasks still need a model call.
 * A pass stays a pass. An HTTP 400 is not a pass.
 */

export function tokensFor(task) {
  if (task.type === 'code') return 360;
  if (task.type === 'file') return 220;
  return 80;
}

export function selectPending(tasks, row) {
  const have = row?.tasks || [];
  const indexes = [];
  for (let index = 0; index < tasks.length; index++) {
    if (!have[index] || have[index].pass !== true) indexes.push(index);
  }
  return indexes;
}

export function requestFor(agent, task) {
  return {
    id: task.id,
    name: agent.name,
    source: agent.source,
    type: task.type,
    kind: task.kind,
    system: String(agent.instructions || '').slice(0, 600),
    user: task.prompt,
    maxTokens: tokensFor(task),
  };
}
