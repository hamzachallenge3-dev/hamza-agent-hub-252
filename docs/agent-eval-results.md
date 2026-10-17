# Agent evaluation

Two rounds are recorded. They are not the same scale.

Round 1 used local `llama3.2:1b` and a loose rubric whose maximum added up to 115. Mean combined moved from 88.3 to 89.3. That one-point move was smaller than the noise of a 1B model.

Later rounds use a strict 0-100 score. Rubric is 60: 40 for the requirements the task stated, 10 for the requested format, 10 for staying off forbidden or unproven claims. Judge is 40 from the same model: `correct` 0-5 scaled to 24 and `useful` 0-5 scaled to 16. An unparsed judge is 0. A score of 100 means every requirement, the format, the honesty check, and a 5/5 judge. Keyword overlap alone cannot reach 100.

When `GROQ_API_KEY` is set, the harness calls Groq's free-tier model `openai/gpt-oss-120b` (30 RPM, 1,000 RPD, 8,000 TPM, 200,000 TPD). Calls are sequential, paced under those limits, and back off on HTTP 429. No paid model is called.

Round 1, loose scale, `llama3.2:1b`: before 88.3, after 89.3, 162 agents, 0 errors.

| Phase | Model | Scale | Agents | Errors | At 100 | Mean rubric | Mean judge | Mean combined |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| groq-before | openai/gpt-oss-120b | 0-100 | 162 | 0 | 89 | 57 | 32.2 | 89.1 |
| groq-after | openai/gpt-oss-120b | 0-100 | 162 | 0 | 145 | 58.6 | 38.7 | 97.3 |
| groq-after-2 | openai/gpt-oss-120b | 0-100 | 162 | 0 | 159 | 60 | 39.6 | 99.6 |
| groq-after-3 | openai/gpt-oss-120b | 0-100 | 162 | 0 | 162 | 60 | 40 | 100 |

`groq-before` Groq usage: tokens=116998 requests=236.
`groq-after` Groq usage: tokens=64093 requests=146.
`groq-after-2` Groq usage: tokens=15510 requests=34.
`groq-after-3` Groq usage: tokens=886 requests=2.

## Every agent (groq-after-3)

| Agent | Combined | Rubric | Judge | Requirements | Error |
| --- | ---: | ---: | ---: | --- | --- |
| `adaptive-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `adr-architect` | 100 | 60 | 40 | 3/3 |  |
| `agentdb-specialist` | 100 | 60 | 40 | 4/4 |  |
| `agentic-payments` | 100 | 60 | 40 | 4/4 |  |
| `aidefence-guardian` | 100 | 60 | 40 | 4/4 |  |
| `analyst` | 100 | 60 | 40 | 3/3 |  |
| `api-docs` | 100 | 60 | 40 | 4/4 |  |
| `architect` | 100 | 60 | 40 | 3/3 |  |
| `architecture` | 100 | 60 | 40 | 3/3 |  |
| `autopilot-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `backend-dev` | 100 | 60 | 40 | 4/4 |  |
| `backtest-engineer` | 100 | 60 | 40 | 4/4 |  |
| `base-template-generator` | 100 | 60 | 40 | 4/4 |  |
| `Benchmark Suite` | 100 | 60 | 40 | 3/3 |  |
| `browser-agent` | 100 | 60 | 40 | 4/4 |  |
| `builder` | 100 | 60 | 40 | 4/4 |  |
| `byzantine-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `cicd-engineer` | 100 | 60 | 40 | 3/3 |  |
| `claims-authorizer` | 100 | 60 | 40 | 3/3 |  |
| `code-analyzer` | 100 | 60 | 40 | 3/3 |  |
| `code-goal-planner` | 100 | 60 | 40 | 3/3 |  |
| `code-review-swarm` | 100 | 60 | 40 | 4/4 |  |
| `coder` | 100 | 60 | 40 | 4/4 |  |
| `codex-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `codex-worker` | 100 | 60 | 40 | 4/4 |  |
| `collective-intelligence-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `consensus-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `coordinator` | 100 | 60 | 40 | 4/4 |  |
| `cost-analyst` | 100 | 60 | 40 | 3/3 |  |
| `crdt-synchronizer` | 100 | 60 | 40 | 4/4 |  |
| `daa-specialist` | 100 | 60 | 40 | 3/3 |  |
| `data-engineer` | 100 | 60 | 40 | 4/4 |  |
| `database-specialist` | 100 | 60 | 40 | 3/3 |  |
| `ddd-domain-expert` | 100 | 60 | 40 | 3/3 |  |
| `deep-researcher` | 100 | 60 | 40 | 4/4 |  |
| `deepseek-architect` | 100 | 60 | 40 | 3/3 |  |
| `device-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `docs-writer` | 100 | 60 | 40 | 4/4 |  |
| `domain-modeler` | 100 | 60 | 40 | 3/3 |  |
| `dossier-investigator` | 100 | 60 | 40 | 3/3 |  |
| `dual-orchestrator` | 100 | 60 | 40 | 4/4 |  |
| `federation-coordinator` | 100 | 60 | 40 | 3/3 |  |
| `fleet-manager` | 100 | 60 | 40 | 4/4 |  |
| `flow-nexus-app-store` | 100 | 60 | 40 | 4/4 |  |
| `flow-nexus-auth` | 100 | 60 | 40 | 4/4 |  |
| `flow-nexus-challenges` | 100 | 60 | 40 | 4/4 |  |
| `flow-nexus-neural` | 100 | 60 | 40 | 4/4 |  |
| `flow-nexus-payments` | 100 | 60 | 40 | 4/4 |  |
| `flow-nexus-sandbox` | 100 | 60 | 40 | 4/4 |  |
| `flow-nexus-swarm` | 100 | 60 | 40 | 4/4 |  |
| `flow-nexus-user-tools` | 100 | 60 | 40 | 4/4 |  |
| `flow-nexus-workflow` | 100 | 60 | 40 | 4/4 |  |
| `gaia-benchmark-runner` | 100 | 60 | 40 | 3/3 |  |
| `gaia-submission-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `git-specialist` | 100 | 60 | 40 | 4/4 |  |
| `github-modes` | 100 | 60 | 40 | 3/3 |  |
| `goal-planner` | 100 | 60 | 40 | 4/4 |  |
| `gossip-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `graph-navigator` | 100 | 60 | 40 | 4/4 |  |
| `hierarchical-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `horizon-tracker` | 100 | 60 | 40 | 3/3 |  |
| `injection-analyst` | 100 | 60 | 40 | 3/3 |  |
| `intelligence-specialist` | 100 | 60 | 40 | 4/4 |  |
| `issue-tracker` | 100 | 60 | 40 | 4/4 |  |
| `llm-specialist` | 100 | 60 | 40 | 4/4 |  |
| `Load Balancing Coordinator` | 100 | 60 | 40 | 4/4 |  |
| `loop-worker-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `market-analyst` | 100 | 60 | 40 | 4/4 |  |
| `matrix-optimizer` | 100 | 60 | 40 | 3/3 |  |
| `memory-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `memory-specialist` | 100 | 60 | 40 | 4/4 |  |
| `mesh-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `metaharness-architect` | 100 | 60 | 40 | 3/3 |  |
| `migration-engineer` | 100 | 60 | 40 | 4/4 |  |
| `migration-planner` | 100 | 60 | 40 | 4/4 |  |
| `ml-developer` | 100 | 60 | 40 | 4/4 |  |
| `mobile-dev` | 100 | 60 | 40 | 4/4 |  |
| `multi-repo-swarm` | 100 | 60 | 40 | 4/4 |  |
| `music-composer` | 100 | 60 | 40 | 4/4 |  |
| `music-producer` | 100 | 60 | 40 | 4/4 |  |
| `nested-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `nested-leaf` | 100 | 60 | 40 | 3/3 |  |
| `nested-queen` | 100 | 60 | 40 | 4/4 |  |
| `nested-queen-leaf` | 100 | 60 | 40 | 4/4 |  |
| `nested-queen-researcher` | 100 | 60 | 40 | 4/4 |  |
| `nested-queen-reviewer` | 100 | 60 | 40 | 4/4 |  |
| `nested-researcher` | 100 | 60 | 40 | 4/4 |  |
| `nested-reviewer` | 100 | 60 | 40 | 4/4 |  |
| `observability-engineer` | 100 | 60 | 40 | 4/4 |  |
| `pagerank-analyzer` | 100 | 60 | 40 | 4/4 |  |
| `perf-analyzer` | 100 | 60 | 40 | 4/4 |  |
| `Performance Monitor` | 100 | 60 | 40 | 3/3 |  |
| `performance-benchmarker` | 100 | 60 | 40 | 4/4 |  |
| `performance-engineer` | 100 | 60 | 40 | 3/3 |  |
| `performance-optimizer` | 100 | 60 | 40 | 3/3 |  |
| `pii-detector` | 100 | 60 | 40 | 3/3 |  |
| `planner` | 100 | 60 | 40 | 4/4 |  |
| `plugin-developer` | 100 | 60 | 40 | 4/4 |  |
| `pr-manager` | 100 | 60 | 40 | 3/3 |  |
| `production-validator` | 100 | 60 | 40 | 3/3 |  |
| `project-board-sync` | 100 | 60 | 40 | 4/4 |  |
| `project-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `pseudocode` | 100 | 60 | 40 | 4/4 |  |
| `python-specialist` | 100 | 60 | 40 | 4/4 |  |
| `queen-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `quorum-manager` | 100 | 60 | 40 | 4/4 |  |
| `raft-manager` | 100 | 60 | 40 | 4/4 |  |
| `reasoningbank-learner` | 100 | 60 | 40 | 4/4 |  |
| `refinement` | 100 | 60 | 40 | 4/4 |  |
| `release-manager` | 100 | 60 | 40 | 3/3 |  |
| `release-swarm` | 100 | 60 | 40 | 4/4 |  |
| `repo-architect` | 100 | 60 | 40 | 3/3 |  |
| `researcher` | 100 | 60 | 40 | 3/3 |  |
| `Resource Allocator` | 100 | 60 | 40 | 3/3 |  |
| `reviewer` | 100 | 60 | 40 | 3/3 |  |
| `risk-analyst` | 100 | 60 | 40 | 4/4 |  |
| `ruos-host-operator` | 100 | 60 | 40 | 4/4 |  |
| `safety-specialist` | 100 | 60 | 40 | 3/3 |  |
| `safla-neural` | 100 | 60 | 40 | 4/4 |  |
| `scout-explorer` | 100 | 60 | 40 | 3/3 |  |
| `security-architect` | 100 | 60 | 40 | 3/3 |  |
| `security-architect-aidefence` | 100 | 60 | 40 | 3/3 |  |
| `security-auditor` | 100 | 60 | 40 | 3/3 |  |
| `security-manager` | 100 | 60 | 40 | 3/3 |  |
| `session-specialist` | 100 | 60 | 40 | 4/4 |  |
| `smart-agent` | 100 | 60 | 40 | 4/4 |  |
| `sona-learning-optimizer` | 100 | 60 | 40 | 4/4 |  |
| `sparc-coder` | 100 | 60 | 40 | 3/3 |  |
| `sparc-coord` | 100 | 60 | 40 | 4/4 |  |
| `sparc-orchestrator` | 100 | 60 | 40 | 4/4 |  |
| `specification` | 100 | 60 | 40 | 4/4 |  |
| `sublinear-goal-planner` | 100 | 60 | 40 | 4/4 |  |
| `swarm-init` | 100 | 60 | 40 | 4/4 |  |
| `swarm-issue` | 100 | 60 | 40 | 4/4 |  |
| `swarm-memory-manager` | 100 | 60 | 40 | 4/4 |  |
| `swarm-pr` | 100 | 60 | 40 | 4/4 |  |
| `sync-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `system-architect` | 100 | 60 | 40 | 3/3 |  |
| `task-orchestrator` | 100 | 60 | 40 | 4/4 |  |
| `tdd-london-swarm` | 100 | 60 | 40 | 3/3 |  |
| `team-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `telemetry-analyzer` | 100 | 60 | 40 | 4/4 |  |
| `test-architect` | 100 | 60 | 40 | 3/3 |  |
| `test-long-runner` | 100 | 60 | 40 | 3/3 |  |
| `tester` | 100 | 60 | 40 | 3/3 |  |
| `Topology Optimizer` | 100 | 60 | 40 | 4/4 |  |
| `trading-predictor` | 100 | 60 | 40 | 4/4 |  |
| `trading-strategist` | 100 | 60 | 40 | 4/4 |  |
| `typescript-specialist` | 100 | 60 | 40 | 4/4 |  |
| `v3-integration-architect` | 100 | 60 | 40 | 3/3 |  |
| `v3-memory-specialist` | 100 | 60 | 40 | 4/4 |  |
| `v3-performance-engineer` | 100 | 60 | 40 | 3/3 |  |
| `v3-queen-coordinator` | 100 | 60 | 40 | 4/4 |  |
| `v3-security-architect` | 100 | 60 | 40 | 3/3 |  |
| `vector-engineer` | 100 | 60 | 40 | 4/4 |  |
| `verifier` | 100 | 60 | 40 | 4/4 |  |
| `wasm-specialist` | 100 | 60 | 40 | 4/4 |  |
| `witness-auditor` | 100 | 60 | 40 | 3/3 |  |
| `witness-curator` | 100 | 60 | 40 | 3/3 |  |
| `worker-specialist` | 100 | 60 | 40 | 4/4 |  |
| `workflow-automation` | 100 | 60 | 40 | 4/4 |  |
| `workflow-specialist` | 100 | 60 | 40 | 4/4 |  |

Judge JSON parsed for 162 of 162 rows.

Raw rows, including model output, are in `docs/eval/`.
