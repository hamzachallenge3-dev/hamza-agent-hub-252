/**
 * Five distinct planner -> coder -> tester tasks.
 * The grade is the executed cases. Each role still has to return a real artifact.
 */

export const SWARM_TASKS = [
  {
    id: 'is-even',
    exportName: 'isEven',
    behavior: 'isEven(n) returns true for a finite even number, false for a finite odd number, and throws Error("nan") when n is not finite. 0 and negative evens are even.',
    cases: [
      { args: [2], expect: true },
      { args: [3], expect: false },
      { args: [0], expect: true },
      { args: [-4], expect: true },
      { args: [-3], expect: false },
      { args: [{ $nan: true }], throws: 'nan' },
      { args: [{ $inf: true }], throws: 'nan' },
    ],
  },
  {
    id: 'clamp',
    exportName: 'clamp',
    behavior: 'clamp(n, lo, hi) throws Error("nan") when n is not finite. If n < lo return lo. If n > hi return hi. Otherwise return n.',
    cases: [
      { args: [5, 0, 3], expect: 3 },
      { args: [-1, 0, 3], expect: 0 },
      { args: [2, 0, 3], expect: 2 },
      { args: [{ $nan: true }, 0, 1], throws: 'nan' },
    ],
  },
  {
    id: 'word-count',
    exportName: 'wordCount',
    behavior: 'wordCount(text) returns how many whitespace-separated words text contains. Empty or whitespace-only text returns 0. A newline is whitespace.',
    cases: [
      { args: ['a b c'], expect: 3 },
      { args: [''], expect: 0 },
      { args: ['  one  '], expect: 1 },
      { args: ['a\nb c'], expect: 3 },
    ],
  },
  {
    id: 'safe-div',
    exportName: 'safeDiv',
    behavior: 'safeDiv(a, b) returns a/b. When b === 0 it throws Error("div0").',
    cases: [
      { args: [6, 2], expect: 3 },
      { args: [5, -1], expect: -5 },
      { args: [-8, 2], expect: -4 },
      { args: [1, 0], throws: 'div0' },
    ],
  },
  {
    id: 'slug',
    exportName: 'slug',
    behavior: 'slug(text) lowercases text, replaces each run of non-letters and non-digits with one hyphen, and trims hyphens from both ends.',
    cases: [
      { args: ['Hello World'], expect: 'hello-world' },
      { args: ['A--B'], expect: 'a-b' },
      { args: ['  Hi! '], expect: 'hi' },
      { args: [''], expect: '' },
    ],
  },
];

export function plannerPrompt(task) {
  return [
    'Return only a JSON object with keys functionName and behavior.',
    `functionName must be ${task.exportName}.`,
    'behavior must be one sentence describing the function.',
    `Behavior to preserve: ${task.behavior}`,
  ].join('\n');
}

export function coderPrompt(task, specText) {
  return [
    `Read spec.json and implement ${task.exportName}.`,
    task.behavior,
    'Return only an ES module. No markdown.',
    'spec.json:',
    specText,
  ].join('\n');
}

export function testerPrompt(task, specText, codeText) {
  return [
    'Read the spec and the module. Return only JSON {"passed":true} or {"passed":false}.',
    'passed is true only if the module implements the behavior.',
    'spec.json:',
    specText,
    'module:',
    codeText,
  ].join('\n');
}
