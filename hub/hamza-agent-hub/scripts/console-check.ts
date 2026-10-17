/**
 * End-to-end check of the operator console (Part 12) in a real browser.
 *
 * Drives the page the way an operator does — connect, plan, execute — and
 * fails on any console error or any panel that did not populate. This exists
 * because the console is the one surface the API contract tests cannot cover:
 * the same-origin write bug was invisible to them and only showed up here.
 *
 * Usage: npx tsx scripts/console-check.ts <baseUrl> <token> [screenshotDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:8799';
const token = process.argv[3];
const shotDir = process.argv[4] ?? '';
if (!token) {
  console.error('usage: console-check.ts <baseUrl> <token> [screenshotDir]');
  process.exit(2);
}

const problems: string[] = [];

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1800 } });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });

  await page.goto(`${base}/ui`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('health')?.textContent !== 'checking…');

  await page.fill('#token', token);
  await page.click('#connect');

  // The roster tiles are filled from /v1/audit, which runs the smoke checks.
  await page.waitForFunction(() => (document.getElementById('rosterStats')?.children.length ?? 0) > 0, { timeout: 60_000 });

  const roster = await page.$$eval('#rosterStats .stat', (tiles) =>
    tiles.map((t) => [t.querySelector('small')?.textContent, t.querySelector('.num')?.textContent])
  );
  if (!roster.length) problems.push('roster tiles did not render');
  const agentRows = await page.$$eval('#agentTable tbody tr', (rows) => rows.length);
  if (agentRows < 2) problems.push(`agent table rendered ${agentRows} row(s)`);
  const integrations = await page.$$eval('#integrationTable tbody tr', (rows) => rows.length);
  if (integrations < 1) problems.push('integration table did not render');

  // Deliberately multi-capability: a single-subtask mission would not exercise
  // the orchestration the console is meant to show.
  await page.fill(
    '#mission',
    'Clean the lead list then audit the SEO of the landing page then review the python code. Do not execute anything or use paid services.'
  );
  await page.click('#plan');
  await page.waitForSelector('#bossDetail table tbody tr', { timeout: 30_000 });
  const plannedSubtasks = await page.$$eval('#bossDetail table tbody tr', (rows) => rows.length);
  if (plannedSubtasks < 2) problems.push(`plan showed ${plannedSubtasks} subtask(s); expected a multi-agent plan`);

  const constraints = await page.$$eval('#bossDetail ul li', (items) => items.map((i) => i.textContent ?? ''));
  if (!constraints.some((c) => c.includes('no_execution'))) problems.push('no_execution constraint not shown on the plan');
  if (!constraints.some((c) => c.includes('no_spend'))) problems.push('no_spend constraint not shown on the plan');
  if (shotDir) await shoot(page, shotDir, 'console-plan');

  await page.click('#execute');
  await page.waitForFunction(
    () => /COMPLETED_VERIFIED|COMPLETED_LIMITED|BLOCKED|FAILED|CANCELLED/.test(document.getElementById('missionStatus')?.textContent ?? ''),
    { timeout: 60_000 }
  );
  const state = (await page.textContent('#missionStatus'))?.trim() ?? '';
  const ranSubtasks = await page.$$eval('#planOut table tbody tr', (rows) => rows.length);
  if (ranSubtasks < 2) problems.push(`result showed ${ranSubtasks} subtask(s); the mission should have run several`);
  if (shotDir) await shoot(page, shotDir, 'console-executed');

  await browser.close();

  console.log('roster tiles      ', roster.map(([k, v]) => `${k}=${v}`).join('  '));
  console.log('agent rows        ', agentRows);
  console.log('integration rows  ', integrations);
  console.log('plan constraints  ', constraints.length);
  console.log('planned subtasks  ', plannedSubtasks);
  console.log('executed subtasks ', ranSubtasks);
  console.log('mission state     ', state.replace(/\s+/g, ' '));
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('\nconsole check passed');
}

async function shoot(page: import('playwright').Page, dir: string, name: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

await main();
