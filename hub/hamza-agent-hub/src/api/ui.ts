/**
 * The Hub console (Part 12).
 *
 * One self-contained page, no bundler and no CDN, so it works on a CPU-only box
 * with no network. It is a thin client over /v1: everything it shows comes from
 * the same authenticated API any other consumer uses, which means the console
 * cannot show a status the API would not also report.
 *
 * The bearer token is typed by the operator and held in sessionStorage only. It
 * is never baked into the page, never logged, and never sent anywhere except
 * this Hub.
 */
import express from 'express';

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hamza Agent Hub</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --panel-2: #1e222b; --line: #2a2f3a;
    --text: #e6e9ef; --muted: #8b93a7; --accent: #5b8cff;
    --ok: #3ddc97; --warn: #ffb454; --bad: #ff6b6b; --info: #7aa2f7;
    --radius: 10px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  header {
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    padding: 14px 20px; border-bottom: 1px solid var(--line); background: var(--panel);
    position: sticky; top: 0; z-index: 10;
  }
  h1 { font-size: 16px; margin: 0; font-weight: 650; letter-spacing: .2px; }
  h2 { font-size: 13px; margin: 0 0 10px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .6px; }
  .spacer { flex: 1; }
  main { padding: 20px; display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); align-items: start; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; }
  .panel.wide { grid-column: 1 / -1; }
  input, textarea, button, select {
    font: inherit; color: var(--text); background: var(--panel-2);
    border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px;
  }
  input, textarea { width: 100%; }
  textarea { min-height: 84px; resize: vertical; }
  button { cursor: pointer; background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  button.ghost { background: var(--panel-2); border-color: var(--line); color: var(--text); font-weight: 500; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .token { max-width: 300px; }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid transparent; white-space: nowrap; }
  .pill.ok { background: rgba(61,220,151,.12); color: var(--ok); border-color: rgba(61,220,151,.3); }
  .pill.warn { background: rgba(255,180,84,.12); color: var(--warn); border-color: rgba(255,180,84,.3); }
  .pill.bad { background: rgba(255,107,107,.12); color: var(--bad); border-color: rgba(255,107,107,.3); }
  .pill.info { background: rgba(122,162,247,.12); color: var(--info); border-color: rgba(122,162,247,.3); }
  .kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; align-items: baseline; }
  .kv dt { color: var(--muted); }
  .kv dd { margin: 0; }
  .num { font-size: 26px; font-weight: 680; letter-spacing: -.5px; }
  .num.ok { color: var(--ok); } .num.warn { color: var(--warn); }
  .num.bad { color: var(--bad); } .num.info { color: var(--info); }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 12px; }
  .stat { background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
  .stat small { color: var(--muted); display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  .steps { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
  .step { flex: 1; min-width: 86px; text-align: center; padding: 7px 4px; border-radius: 8px; background: var(--panel-2); border: 1px solid var(--line); font-size: 12px; color: var(--muted); }
  .step.active { border-color: var(--accent); color: var(--text); }
  .step.done { border-color: var(--ok); color: var(--ok); }
  pre { background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 12px; overflow: auto; max-height: 320px; font-size: 12px; margin: 0; white-space: pre-wrap; word-break: break-word; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  .muted { color: var(--muted); }
  .bar { height: 6px; background: var(--panel-2); border-radius: 999px; overflow: hidden; border: 1px solid var(--line); }
  .bar > i { display: block; height: 100%; background: var(--accent); transition: width .3s; }
  .err { color: var(--bad); }
  .scroll { max-height: 340px; overflow: auto; }
  label small { color: var(--muted); display: block; margin-bottom: 4px; }
</style>
</head>
<body>
<header>
  <h1>Hamza Agent Hub</h1>
  <span id="health" class="pill info">checking…</span>
  <span id="modelPill" class="pill warn">model ?</span>
  <span id="browserPill" class="pill warn">browser ?</span>
  <div class="spacer"></div>
  <label class="token"><input id="token" type="password" placeholder="API token" autocomplete="off"></label>
  <button id="connect">Connect</button>
  <button id="advancedToggle" class="ghost">Advanced</button>
</header>

<main>
  <section class="panel wide">
    <h2>Run a mission</h2>
    <div class="steps">
      <div class="step" data-step="prompt">1 · Prompt</div>
      <div class="step" data-step="plan">2 · Plan</div>
      <div class="step" data-step="execute">3 · Execute</div>
      <div class="step" data-step="verify">4 · Verify</div>
      <div class="step" data-step="download">5 · Download</div>
    </div>
    <label><small>What should the Hub do?</small>
      <textarea id="mission" placeholder="Review the checkout module for security problems. Do not execute anything or use paid services."></textarea>
    </label>
    <div class="row" style="margin-top:10px">
      <button id="plan">Plan</button>
      <button id="execute" class="ghost" disabled>Execute</button>
      <button id="cancel" class="ghost" disabled>Cancel</button>
      <span id="missionStatus" class="muted"></span>
    </div>
    <div class="bar" style="margin-top:12px"><i id="progress" style="width:0%"></i></div>
    <div id="planOut" style="margin-top:12px"></div>
  </section>

  <section class="panel">
    <h2>Boss plan</h2>
    <div id="bossDetail" class="muted">Plan a mission to see routing, constraints and gaps.</div>
  </section>

  <section class="panel">
    <h2>Roster</h2>
    <div class="stats" id="rosterStats"></div>
    <div style="margin-top:12px" class="row">
      <select id="readinessFilter" class="ghost">
        <option value="">All readiness</option>
        <option value="READY">READY</option>
        <option value="LIMITED">LIMITED</option>
        <option value="BLOCKED">BLOCKED</option>
        <option value="UNTESTED">UNTESTED</option>
      </select>
    </div>
    <div class="scroll" style="margin-top:10px"><table id="agentTable"><tbody></tbody></table></div>
  </section>

  <section class="panel">
    <h2>Model providers</h2>
    <div id="modelDetail" class="muted">—</div>
  </section>

  <section class="panel">
    <h2>Browser sessions</h2>
    <div id="browserDetail" class="muted">—</div>
  </section>

  <section class="panel">
    <h2>API integrations</h2>
    <div class="scroll"><table id="integrationTable"><tbody></tbody></table></div>
  </section>

  <section class="panel">
    <h2>Errors and blockers</h2>
    <div id="blockers" class="muted">—</div>
  </section>

  <section class="panel wide" id="advanced" hidden>
    <h2>Diagnostics</h2>
    <pre id="diagnostics">—</pre>
  </section>
</main>

<script>
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  // Session-scoped only: the token is never persisted to disk or sent elsewhere.
  const store = window.sessionStorage;
  let token = store.getItem('hah_token') || '';
  let currentTask = null;
  let approvalOwner = null;
  let poll = null;
  let lastPlan = null;

  $('token').value = token;

  function headers(extra) {
    return Object.assign({ Authorization: 'Bearer ' + token }, extra || {});
  }

  async function api(path, options) {
    // Merge into the caller's options rather than the other way round: spreading
    // options last replaced the whole headers object, which silently dropped the
    // Authorization header on every request that set Content-Type.
    const opts = Object.assign({}, options || {});
    opts.headers = headers(opts.headers);
    const res = await fetch(path, opts);
    let body = null;
    try { body = await res.json(); } catch (_) { body = null; }
    if (!res.ok) {
      const message = body && body.error ? body.error.message : res.status + ' ' + res.statusText;
      const recovery = body && body.error && body.error.recovery ? ' — ' + body.error.recovery : '';
      throw new Error(message + recovery);
    }
    return body;
  }

  function pill(el, state, text) {
    el.className = 'pill ' + state;
    el.textContent = text;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function readinessClass(readiness) {
    if (readiness === 'READY') return 'ok';
    if (readiness === 'LIMITED') return 'warn';
    if (readiness === 'BLOCKED') return 'bad';
    return 'info';
  }

  function setStep(name) {
    const order = ['prompt', 'plan', 'execute', 'verify', 'download'];
    const at = order.indexOf(name);
    document.querySelectorAll('.step').forEach((el) => {
      const index = order.indexOf(el.dataset.step);
      el.className = 'step' + (index < at ? ' done' : index === at ? ' active' : '');
    });
  }

  async function refreshHealth() {
    try {
      const ready = await (await fetch('/health/ready')).json();
      pill($('health'), ready.ready ? 'ok' : 'bad', ready.ready ? 'hub ready' : 'hub not ready');
      const model = ready.checks && ready.checks.model;
      if (model) {
        pill($('modelPill'), model.ok ? 'ok' : 'bad', 'model ' + (model.readiness || (model.ok ? 'ready' : 'blocked')));
      }
      const browser = ready.checks && ready.checks.browser;
      if (browser) {
        pill($('browserPill'), browser.ok ? 'ok' : 'warn', 'browser ' + (browser.readiness || (browser.ok ? 'ready' : 'unavailable')));
      }
    } catch (err) {
      pill($('health'), 'bad', 'hub unreachable');
    }
  }

  async function refreshAuthed() {
    if (!token) return;
    const problems = [];

    try {
      const diag = await api('/v1/diagnostics');
      $('diagnostics').textContent = JSON.stringify(diag, null, 2);
      if (diag.tools13 && diag.tools13.blocked) {
        problems.push(diag.tools13.blocked + ' of ' + diag.tools13.catalog_entries + ' Tools13 services are blocked upstream');
      }
    } catch (err) {
      problems.push('diagnostics: ' + err.message);
    }

    try {
      const model = await api('/v1/model/health');
      const rows = (model.providers || []).map((p) =>
        '<tr><td>' + esc(p.id) + '</td><td><span class="pill ' + (p.ok ? 'ok' : p.configured ? 'bad' : 'info') + '">' +
        (p.ok ? 'live' : p.configured ? 'down' : 'not configured') + '</span></td>' +
        '<td class="muted">' + esc(p.error || p.hint || '') + '</td></tr>'
      ).join('');
      $('modelDetail').innerHTML = '<dl class="kv"><dt>readiness</dt><dd><span class="pill ' +
        (model.readiness === 'ready' ? 'ok' : 'bad') + '">' + esc(model.readiness) + '</span></dd>' +
        '<dt>configured</dt><dd>' + esc((model.configured_providers || []).join(', ') || 'none') + '</dd></dl>' +
        (rows ? '<table style="margin-top:10px"><tbody>' + rows + '</tbody></table>' : '') +
        (model.degraded_mode ? '<p class="err">' + esc(model.degraded_mode) + '</p>' : '');
      if (model.readiness !== 'ready') {
        problems.push('No live AI model: reasoning agents return deterministic output marked COMPLETED_LIMITED.');
      }
    } catch (err) {
      problems.push('model health: ' + err.message);
    }

    try {
      const browser = await api('/v1/browser/sessions');
      const list = browser.sessions || [];
      const availability = browser.availability || {};
      $('browserDetail').innerHTML = '<dl class="kv"><dt>runtime</dt><dd><span class="pill ' +
        readinessClass(availability.readiness) + '">' + esc(availability.readiness || 'unknown') +
        '</span></dd><dt>open</dt><dd>' + list.length + ' / ' + esc(browser.max_sessions != null ? browser.max_sessions : '?') +
        '</dd>' + (availability.playwright_version ? '<dt>playwright</dt><dd>' + esc(availability.playwright_version) + '</dd>' : '') +
        '</dl>' + (availability.reason ? '<p class="muted">' + esc(availability.reason) + '</p>' : '') +
        (list.length ? '<pre style="margin-top:10px">' + esc(JSON.stringify(list, null, 2)) + '</pre>' : '');
    } catch (err) {
      problems.push('browser: ' + err.message);
    }

    try {
      const integrations = await api('/v1/integrations');
      const rows = (integrations.integrations || []).map((i) => {
        const health = i.health || {};
        // Cost is shown because enabling a paid API needs explicit approval.
        const paid = i.cost && i.cost.paid ? ' <span class="pill bad">paid</span>' : '';
        return '<tr><td>' + esc(i.label || i.id) + paid + '<br><small class="muted">' + esc(i.category) + '</small></td>' +
          '<td><span class="pill ' + readinessClass(health.readiness) + '">' + esc(health.readiness || 'unknown') + '</span></td>' +
          '<td class="muted">' + esc(health.detail || (i.auth && i.auth.hint) || '') + '</td></tr>';
      }).join('');
      $('integrationTable').querySelector('tbody').innerHTML = rows || '<tr><td class="muted">none</td></tr>';
    } catch (err) {
      problems.push('integrations: ' + err.message);
    }

    await refreshAgents();
    $('blockers').innerHTML = problems.length
      ? '<ul style="margin:0;padding-left:18px">' + problems.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul>'
      : '<span class="pill ok">no blockers reported</span>';
  }

  // Tiles and list come from one /v1/audit response so they cannot disagree.
  // Filling the tiles from /v1/diagnostics and the list from /v1/agents showed
  // the structural classification beside the measured one, which read as a bug.
  async function refreshAgents() {
    const readiness = $('readinessFilter').value;
    try {
      const query = '/v1/audit?limit=200' + (readiness ? '&readiness=' + encodeURIComponent(readiness) : '');
      const data = await api(query);
      const s = data.summary || {};
      $('rosterStats').innerHTML =
        stat('registered', s.total, 'info') + stat('ready', s.ready, 'ok') +
        stat('limited', s.limited, 'warn') + stat('blocked', s.blocked, 'bad') +
        stat('untested', s.untested, 'info');
      $('agentTable').querySelector('tbody').innerHTML = (data.agents || []).map((a) =>
        '<tr><td>' + esc(a.agent_id) + '<br><small class="muted">' + esc(a.responsibility) + '</small></td>' +
        '<td><span class="pill ' + readinessClass(a.readiness) + '">' + esc(a.readiness) + '</span>' +
        '<br><small class="muted">' + esc(a.verified_tools.length) + '/' + esc(a.tools.length) +
        ' tools checked</small></td></tr>'
      ).join('') || '<tr><td class="muted">no agents match</td></tr>';
    } catch (err) {
      $('agentTable').querySelector('tbody').innerHTML = '<tr><td class="err">' + esc(err.message) + '</td></tr>';
    }
  }

  function stat(label, value, state) {
    return '<div class="stat"><small>' + label + '</small><div class="num ' + state + '">' +
      esc(value == null ? '—' : value) + '</div></div>';
  }

  function renderPlan(plan) {
    lastPlan = plan;
    const subtasks = (plan.decomposition || []).map((s, i) =>
      '<tr><td>' + (i + 1) + '</td><td>' + esc(s.role) +
      '<br><small class="muted">' + esc([s.capability].concat(s.covers || []).filter(Boolean).join(' + ')) + '</small>' +
      '</td><td>' + esc(s.agent_id) +
      '</td><td><span class="pill ' + readinessClass(s.readiness) + '">' + esc(s.readiness) + '</span></td></tr>'
    ).join('');

    $('bossDetail').innerHTML =
      (plan.unclassified ? '<p class="pill warn">mission not classified — clarify the goal</p>' : '') +
      '<dl class="kv"><dt>primary</dt><dd>' + esc(plan.primary) + '</dd>' +
      '<dt>roster</dt><dd>' + esc(plan.roster_size) + ' agents</dd>' +
      '<dt>rationale</dt><dd class="muted">' + esc(plan.rationale) + '</dd></dl>' +
      (subtasks ? '<table style="margin-top:10px"><thead><tr><th>#</th><th>role</th><th>agent</th><th>readiness</th></tr></thead><tbody>' + subtasks + '</tbody></table>' : '') +
      ((plan.constraints || []).length
        ? '<h2 style="margin-top:14px">Constraints on every subtask</h2><ul style="margin:0;padding-left:18px">' +
          plan.constraints.map((c) => '<li>[' + esc(c.kind) + '] ' + esc(c.text) + '</li>').join('') + '</ul>'
        : '') +
      ((plan.capability_gaps || []).length
        ? '<h2 style="margin-top:14px">Capability gaps</h2><ul style="margin:0;padding-left:18px">' +
          plan.capability_gaps.map((g) => '<li>' + esc(g.capability) + ': ' + esc(g.reason) + '</li>').join('') + '</ul>'
        : '');

    $('planOut').innerHTML = '<p class="muted">Planned ' + (plan.decomposition || []).length +
      ' subtask(s). Review the routing, then Execute.</p>';
    $('execute').disabled = !(plan.decomposition || []).length;
    setStep('plan');
  }

  async function doPlan() {
    const task = $('mission').value.trim();
    if (!task) return;
    $('plan').disabled = true;
    $('missionStatus').textContent = 'planning…';
    try {
      renderPlan(await api('/v1/missions/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: task }),
      }));
      $('missionStatus').textContent = 'plan ready';
    } catch (err) {
      $('missionStatus').innerHTML = '<span class="err">' + esc(err.message) + '</span>';
    } finally {
      $('plan').disabled = false;
    }
  }

  async function doExecute() {
    if (!lastPlan) return;
    $('execute').disabled = true;
    setStep('execute');
    try {
      // No agent_id: run the whole decomposition rather than the primary alone.
      const created = await api('/v1/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'ui-' + Date.now() },
        body: JSON.stringify({ task: $('mission').value.trim() }),
      });
      currentTask = created.task_id;
      $('cancel').disabled = false;
      watch();
    } catch (err) {
      $('missionStatus').innerHTML = '<span class="err">' + esc(err.message) + '</span>';
      $('execute').disabled = false;
    }
  }

  function watch() {
    clearInterval(poll);
    poll = setInterval(tick, 1200);
    tick();
  }

  async function tick() {
    if (!currentTask) return;
    try {
      const task = await api('/v1/missions/' + currentTask);
      $('progress').style.width = Math.round((task.progress || 0) * 100) + '%';
      // A mission names the subtask currently executing; a single-agent task
      // names its own agent.
      const working = task.active_agent || task.agent_id;
      $('missionStatus').innerHTML = '<span class="pill ' + stateClass(task.state) + '">' + esc(task.state) + '</span> ' +
        esc(task.progress_message || '') + (working ? ' · ' + esc(working) : '');
      if (task.subtasks) renderSubtasks(task.subtasks);

      // An approval checkpoint is the one case where the Hub needs a human.
      const approval = await api('/v1/missions/' + currentTask + '/approval');
      if (approval.awaiting_approval) {
        // On a mission the checkpoint belongs to one subtask, and that is the
        // id the decision has to be posted against.
        renderApproval(approval.pending, approval.task_id);
        return;
      }

      if (['COMPLETED_VERIFIED', 'COMPLETED_LIMITED', 'BLOCKED', 'FAILED', 'CANCELLED'].indexOf(task.state) >= 0) {
        clearInterval(poll);
        $('cancel').disabled = true;
        $('execute').disabled = false;
        setStep(task.verified ? 'download' : 'verify');
        renderResult(task);
      }
    } catch (err) {
      clearInterval(poll);
      $('missionStatus').innerHTML = '<span class="err">' + esc(err.message) + '</span>';
    }
  }

  // Live per-subtask progress, so the operator sees which agent is working and
  // which are still waiting on an upstream result.
  function renderSubtasks(subtasks) {
    const rows = subtasks.map((s, i) =>
      '<tr><td>' + (i + 1) + '</td><td>' + esc(s.role) + '<br><small class="muted">' + esc(s.agent_id) + '</small></td>' +
      '<td><span class="pill ' + stateClass(s.state) + '">' + esc(s.state) + '</span>' +
      (s.depends_on && s.depends_on.length ? '<br><small class="muted">after ' + s.depends_on.length + ' subtask(s)</small>' : '') +
      '</td><td class="muted">' + esc(s.error || s.progress_message || '') + '</td></tr>'
    ).join('');
    $('planOut').innerHTML =
      '<table><thead><tr><th>#</th><th>role</th><th>state</th><th>detail</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function stateClass(state) {
    if (state === 'COMPLETED_VERIFIED') return 'ok';
    if (state === 'COMPLETED_LIMITED' || state === 'WAITING_FOR_APPROVAL') return 'warn';
    if (state === 'BLOCKED' || state === 'FAILED') return 'bad';
    return 'info';
  }

  function renderApproval(pending, owner) {
    approvalOwner = owner || currentTask;
    $('planOut').innerHTML =
      '<div class="panel" style="border-color:var(--warn)"><h2>Approval required</h2>' +
      '<p>' + esc(pending.describe) + '</p><p class="muted">' + esc(pending.reason) + '</p>' +
      '<div class="row"><input id="actor" placeholder="Your name (recorded in the audit log)">' +
      '<button id="approve">Approve once</button><button id="decline" class="ghost">Decline</button></div></div>';
    $('approve').onclick = () => decide(true);
    $('decline').onclick = () => decide(false);
  }

  async function decide(approve) {
    const actor = ($('actor').value || '').trim();
    if (!actor) { $('actor').focus(); return; }
    try {
      await api('/v1/missions/' + approvalOwner + '/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve: approve, actor: actor }),
      });
      $('planOut').innerHTML = '<p class="muted">' + (approve ? 'Approved. Resuming.' : 'Declined. Mission cancelled.') + '</p>';
      if (approve) watch();
    } catch (err) {
      $('planOut').innerHTML = '<p class="err">' + esc(err.message) + '</p>';
    }
  }

  function renderResult(task) {
    // An artifact is served under the task that recorded it, so a mission's
    // links have to be built per subtask rather than from the merged list.
    const owned = task.subtasks
      ? task.subtasks.flatMap((s) => (s.artifacts || []).map((a) => [s.task_id, a]))
      : (task.artifacts || []).map((a) => [task.task_id, a]);
    const artifacts = owned.map(([owner, a]) =>
      '<li><a href="/v1/artifacts/' + encodeURIComponent(owner) + '?path=' + encodeURIComponent(a) +
      '" data-artifact="' + esc(a) + '">' + esc(a) + '</a></li>'
    ).join('');
    const subtaskTable = task.subtasks
      ? '<h2 style="margin-top:14px">Subtasks</h2><table><tbody>' + task.subtasks.map((s) =>
          '<tr><td>' + esc(s.role) + '<br><small class="muted">' + esc(s.agent_id) + '</small></td>' +
          '<td><span class="pill ' + stateClass(s.state) + '">' + esc(s.state) + '</span></td></tr>'
        ).join('') + '</tbody></table>'
      : '';
    $('planOut').innerHTML =
      '<dl class="kv"><dt>state</dt><dd><span class="pill ' + stateClass(task.state) + '">' + esc(task.state) + '</span></dd>' +
      '<dt>verified</dt><dd>' + (task.verified ? '<span class="pill ok">yes</span>' : '<span class="pill warn">no</span>') + '</dd>' +
      (task.error ? '<dt>error</dt><dd class="err">' + esc(task.error) + '</dd>' : '') + '</dl>' +
      subtaskTable +
      (artifacts ? '<h2 style="margin-top:14px">Verified outputs</h2><ul style="margin:0;padding-left:18px">' + artifacts + '</ul>' : '<p class="muted">No artifacts were produced.</p>');

    // Artifact links need the bearer token, so fetch and hand over a blob.
    $('planOut').querySelectorAll('a[data-artifact]').forEach((link) => {
      link.addEventListener('click', async (event) => {
        event.preventDefault();
        const res = await fetch(link.getAttribute('href'), { headers: headers() });
        if (!res.ok) { link.insertAdjacentHTML('afterend', ' <span class="err">download failed</span>'); return; }
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement('a');
        a.href = url;
        a.download = link.dataset.artifact.split('/').pop();
        a.click();
        URL.revokeObjectURL(url);
      });
    });
  }

  async function doCancel() {
    if (!currentTask) return;
    try {
      await api('/v1/missions/' + currentTask + '/cancel', { method: 'POST' });
    } catch (err) {
      $('missionStatus').innerHTML = '<span class="err">' + esc(err.message) + '</span>';
    }
  }

  $('connect').onclick = () => {
    token = $('token').value.trim();
    store.setItem('hah_token', token);
    refreshAuthed();
  };
  $('advancedToggle').onclick = () => { $('advanced').hidden = !$('advanced').hidden; };
  $('readinessFilter').onchange = refreshAgents;
  $('plan').onclick = doPlan;
  $('execute').onclick = doExecute;
  $('cancel').onclick = doCancel;

  setStep('prompt');
  refreshHealth();
  setInterval(refreshHealth, 15000);
  if (token) refreshAuthed();
})();
</script>
</body>
</html>`;

/**
 * Served unauthenticated because the page itself holds no data: every value it
 * shows is fetched from /v1 with a token the operator supplies at runtime.
 */
export function createUiRouter(): express.Router {
  const router = express.Router();
  router.get('/', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    // No inline-script nonce is needed because the page loads no third-party
    // origin at all; everything is same-origin and self-contained.
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
    res.type('html').send(PAGE);
  });
  return router;
}
