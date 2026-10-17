# Ruflo feature matrix

Tested on this machine with no paid API. The model used for agent evaluation is local Ollama `llama3.2:1b` at `http://127.0.0.1:11434`. Nothing in this table is marked WORKS unless that command or test was run here.

Statuses: **WORKS**, **PARTIAL**, **BROKEN**, **NOT TESTABLE FREE**.

| Area | Status | What was run | What happened |
| --- | --- | --- | --- |
| Agent definitions load | WORKS | `vitest` `agent-catalog.test.ts` | Every shipped agent file parses. Execution uses the first copy in `.ruflo/agents`, `.claude/agents`, `plugins/**/agents`, then the `v3` copies. |
| Distinct agents on a real model | WORKS | `node scripts/eval-agents.mjs` against Ollama, twice | 162 names, 0 request errors both times. Mean combined 88.3 before the prompt edits and 89.3 after. See `docs/agent-eval-results.md`. The 1B judge is weak, and single-run scores jump between a short refusal and a full answer. |
| Spawn a name that contains spaces | WORKS | `ruflo agent spawn -t "Benchmark Suite"` | Stored as `benchmark-suite`. Shell metacharacters are still rejected. |
| Multi-provider router | WORKS | `model-agnostic.test.ts` plus the live Ollama eval | OpenAI-compatible, Anthropic, and Gemini request shapes are covered by unit tests. The live path used was Ollama's OpenAI-compatible chat API. |
| CLI | WORKS | `npx tsx v3/@claude-flow/cli/bin/cli.js --version` and, after `npm run build`, `node v3/@claude-flow/cli/bin/cli.js --version` | Both print `ruflo v3.56.10`. `npm run build` (`tsc`) in `v3/@claude-flow/cli` exits 0 once `nostr-tools` is installed. `dist/` is gitignored, so a fresh checkout needs that build before plain `node` can start the CLI. |
| `agent spawn` / `agent list` | WORKS | Spawned `coder` and `benchmark-suite`, then listed them | Both were stored and listed. Spawn registers the agent. It does not by itself call a model. |
| Memory init, store, retrieve, search | WORKS | `memory init`, `memory store -k probe-note`, `memory retrieve`, `memory search -q "dark mode"` | After `better-sqlite3` was compiled, the note was stored (384-dim local embedding) and search returned it at score 0.90. |
| Memory on the sql.js fallback | PARTIAL | Same store command before the native module existed | The CLI reported a store and then `retrieve` could not find the key. `sql.js` rejected `wal_checkpoint`, so the row never reached the file. Native `better-sqlite3` is the path that persists. `npm install` must not use `--ignore-scripts` for this package, or run `npm rebuild better-sqlite3`. |
| Second memory file | PARTIAL | Retrieve and search warnings | The row is readable. The CLI also warns that `agentdb-memory.db` has a copy that this read did not search. |
| Swarm init and status | WORKS | `swarm init --topology mesh` and `--topology hierarchical`, then `swarm status` | Mesh and hierarchical swarms persisted. Status reported the spawned agent. |
| `swarm coordinate` | PARTIAL | `swarm coordinate --agents 3` | Prints a role table and says the topology is initialized. It does not run the agents. The command tells you to use Claude Code's Task tool or `hive-mind spawn` for execution. |
| Hooks | WORKS | `hooks list`, `hooks pre-task`, `hooks post-task --success` | 26 hooks listed. Pre-task suggested `coder`. Post-task recorded a success and updated patterns. |
| Plugins list | PARTIAL | `plugins list` | Returns the built-in demo catalog and labels every entry Unverified. It is not a live signed registry. |
| MCP tool list and exec | WORKS | `mcp tools`, `mcp exec -t github_repo_analyze` in a scratch git repo | 358 tools listed. Repo analysis returned real git data: 1 commit, 1 branch, 1 contributor. |
| GitHub issues and pull requests | NOT TESTABLE FREE | `gh auth status` | `gh` is installed and not logged in. Remote issue and PR counts stay 0 until a free GitHub login. Local git analysis does not need it. |
| Browser | WORKS | `mcp exec -t browser_open` on `https://example.com`, then `browser_get-title`, then `browser_close` | Title was `Example Domain`. These tools were previously omitted from the registry unless `agent-browser` was already on `PATH`, so `browser_open` returned "tool not found". They are registered now and fall back to `npx agent-browser`. |
| WASM agents | WORKS | `npm install @ruvector/rvagent-wasm@0.1.0`, then `agent wasm-status` and `agent wasm-create -t tester` | Runtime available, 6 gallery templates, agent `wasm-agent-1-mv8pi2ly` created. The package is not a dependency of this repo; it has to be installed. |
| WASM prompt | NOT TESTABLE FREE | Create output | The new agent is pinned to `anthropic:claude-sonnet-4-6`. Sending a prompt would call Anthropic. Creation of the sandbox does not. |
| Terminal console | WORKS | `node plugins/ruflo-console/scripts/build-tui.mjs`, then `ruflo tui --plain --view overview` | One overview frame rendered and named the CLI `v3.56.10`, the project, and the hierarchical swarm. `dist/` is gitignored, so a fresh checkout must run that build once. The AI page is off in this run; it would call Codex or OpenRouter. |
| `doctor` | PARTIAL | `ruflo doctor` in an empty directory, after the optional packages below were installed | 15 passed, 18 warnings, 0 failed. The previous failure (declared `@metaharness/darwin`, `flywheel`, `radio`, `turn-credit` missing) is gone. Remaining warnings are an empty project (no git repo, no config, no memory db, no API keys), Claude Code and `agent-browser` not on `PATH`, `@claude-flow/aidefence` (peer conflict with the installed `agentdb`, so it was not installed), `agentic-flow` absent from `node_modules`, encryption off, Cognitum not logged in, and the Meta LLM proxy (private install). |
| MCP HTTP server | WORKS | `mcp-http-foreground-2984.test.ts`, `mcp-http-protocol-tools-2990.test.ts` | `node bin/cli.js mcp start -t http` stays bound after the success line and shuts down on SIGTERM. JSON-RPC and the legacy SSE path respond. This needed `@claude-flow/mcp` built (`dist/index.js`). |
| Upstream CLI unit tests | WORKS | `npx vitest run --maxWorkers=1` in `v3/@claude-flow/cli`, twice | First run: 6 failed files, 463 passed files, 9 failed tests, 6112 passed. After the fixes below, the re-run was 469 passed files, 1 skipped file, 6132 passed tests, 82 skipped, 0 failed (347s). |
| Paid or account-gated surfaces | NOT TESTABLE FREE | Not called | Anthropic Messages, OpenRouter spend, a signed plugin registry, Cognitum login (`ruflo auth login`), and the private Meta LLM proxy. None of these are free keys. |

## Fixes applied in this pass

- Agent types with spaces, such as `Benchmark Suite`, spawn as a hyphenated id. The MCP validator and the CLI use the same rule. A value with shell metacharacters is rejected.
- `ruflo --version` finds `@claude-flow/cli`'s package.json from either `src/` or `dist/`.
- The help text no longer advertises "150x-12,500x" or "2.49x-7.47x". Those numbers were not measured here.
- Duplicate agent files are marked in place. The copy execution loads is unchanged. The other copies keep their original prompt and gain `duplicateOf` plus a one-line banner.
- Agent prompts that told the model to cite those speedups, or to trade before market data arrives, were rewritten. `trading-predictor` now refuses price prediction and live trades.
- `browser_open` and the rest of the browser tools stay in the MCP registry when `agent-browser` is not installed globally.
- The console looks for `bin/cli.js` from a source checkout as well as from `dist/`.
- Learning-stats tests no longer write `~/.claude-flow/neural/stats.json`. They create a scratch `.claude-flow` and set `CLAUDE_FLOW_CWD`. The counter itself was incrementing once per call. The extra counts were a reload of the home stats file during memory-bridge init.
- Daemon mode no longer calls `process.exit(0)` when `VITEST` is set. A real daemon still exits when its pid file is removed.
- `@claude-flow/cli` `tsc` succeeds. `nostr-tools` and `@agntcy/slim-bindings@2.0.0-alpha.5` are root `optionalDependencies`, because this repo's npm workspaces do not include the CLI package, so a root `npm install` was not installing the CLI's optional deps. The AGNTCY import test and the MCP HTTP tests pass after that install and an `@claude-flow/mcp` build.
- `@metaharness/darwin`, `@metaharness/flywheel`, `@metaharness/radio`, `@metaharness/turn-credit`, and `metaharness` are root optional dependencies. `doctor` no longer fails on the declared-package check.
- The proxy archive tests use one hoisted `SafeExecutor` mock. Per-test `vi.doMock` sometimes fell through to real `tar` and failed on a missing archive.
- The pretrain wiring test keeps its pattern bank in a scratch project, so a second run does not treat the fixture texts as already learned.

## Free accounts

No money was spent. One free credential would change a NOT TESTABLE FREE row. Groq is optional because Ollama already ran the eval.

| Service | Env var | What it unlocks |
| --- | --- | --- |
| GitHub (free account, classic or fine-grained PAT with repo read) | `GH_TOKEN` | Live issue and pull-request counts in `github_issue_track`, `github_pr_manage`, and the issue/PR fields of `github_repo_analyze`. `gh auth login` is the same credential. |

Not requested, because they are not free:

| Service | Why it is not on the list |
| --- | --- |
| Anthropic (`ANTHROPIC_API_KEY`) | `agent_execute` and a WASM prompt default to Claude. That API charges. It was not called. |
| OpenRouter, Cognitum (`ruflo auth login`), Meta LLM proxy | Paid or private. Core commands do not need them. |
