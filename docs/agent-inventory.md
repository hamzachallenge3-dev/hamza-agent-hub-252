# Agent inventory

Generated from the agent files on disk. Each file is a prompt. The harness test loaded every file and sent its body to a local mock model. That checks that the definition is readable and dispatchable. It does not mean the agent performed the job described below.

- Files dispatched: 362
- Distinct names: 162
- Names defined more than once: 97

When a name appears more than once, execution uses the first file in this order: `.ruflo/agents`, `.claude/agents`, `plugins/**/agents`, then the `v3` package copies.

| Name | What the prompt says it does | Source |
| --- | --- | --- |
| `base-template-generator` | Use this agent when you need to create foundational templates, boilerplate code, or starter configurations for new projects, components, or features. This agent excels at genera... | `.claude/agents/base-template-generator.md` |
| `database-specialist` | Database design and optimization specialist | `.claude/agents/database-specialist.md` |
| `project-coordinator` | Coordinates multi-agent workflows for this project | `.claude/agents/project-coordinator.md` |
| `python-specialist` | Python development specialist | `.claude/agents/python-specialist.md` |
| `security-auditor` | Security audit and hardening specialist | `.claude/agents/security-auditor.md` |
| `typescript-specialist` | TypeScript development specialist | `.claude/agents/typescript-specialist.md` |
| `code-analyzer` | Advanced code quality analysis agent for comprehensive code reviews and improvements | `.claude/agents/analysis/analyze-code-quality.md` |
| `analyst` | Advanced code quality analysis agent for comprehensive code reviews and improvements | `.claude/agents/analysis/code-analyzer.md` |
| `byzantine-coordinator` | Coordinates Byzantine fault-tolerant consensus protocols with malicious actor detection | `.claude/agents/consensus/byzantine-coordinator.md` |
| `crdt-synchronizer` | Implements Conflict-free Replicated Data Types for eventually consistent state synchronization | `.claude/agents/consensus/crdt-synchronizer.md` |
| `gossip-coordinator` | Coordinates gossip-based consensus protocols for scalable eventually consistent systems | `.claude/agents/consensus/gossip-coordinator.md` |
| `performance-benchmarker` | Implements comprehensive performance benchmarking for distributed consensus protocols | `.claude/agents/consensus/performance-benchmarker.md` |
| `quorum-manager` | Implements dynamic quorum adjustment and intelligent membership management | `.claude/agents/consensus/quorum-manager.md` |
| `raft-manager` | Manages Raft consensus algorithm with leader election and log replication | `.claude/agents/consensus/raft-manager.md` |
| `security-manager` | Implements comprehensive security mechanisms for distributed consensus protocols | `.claude/agents/consensus/security-manager.md` |
| `coder` | Implementation specialist for writing clean, efficient code | `.claude/agents/core/coder.md` |
| `planner` | Strategic planning and task orchestration agent | `.claude/agents/core/planner.md` |
| `researcher` | Deep research and information gathering specialist | `.claude/agents/core/researcher.md` |
| `reviewer` | Code review and quality assurance specialist | `.claude/agents/core/reviewer.md` |
| `tester` | Comprehensive testing and quality assurance specialist | `.claude/agents/core/tester.md` |
| `test-long-runner` | Test agent that can run for 30+ minutes on complex tasks | `.claude/agents/custom/test-long-runner.md` |
| `backend-dev` | Specialized agent for backend API development with self-learning and pattern recognition | `.claude/agents/development/dev-backend-api.md` |
| `codex-coordinator` | Coordinates multiple headless Codex workers for parallel execution | `.claude/agents/dual-mode/codex-coordinator.md` |
| `codex-worker` | Headless Codex background worker for parallel task execution with self-learning | `.claude/agents/dual-mode/codex-worker.md` |
| `dual-orchestrator` | Orchestrates Claude Code (interactive) + Codex (headless) for hybrid workflows | `.claude/agents/dual-mode/dual-orchestrator.md` |
| `flow-nexus-app-store` | Application marketplace and template management specialist. Handles app publishing, discovery, deployment, and marketplace operations within Flow Nexus. | `.claude/agents/flow-nexus/app-store.md` |
| `flow-nexus-auth` | Flow Nexus authentication and user management specialist. Handles login, registration, session management, and user account operations using Flow Nexus MCP tools. | `.claude/agents/flow-nexus/authentication.md` |
| `flow-nexus-challenges` | Coding challenges and gamification specialist. Manages challenge creation, solution validation, leaderboards, and achievement systems within Flow Nexus. | `.claude/agents/flow-nexus/challenges.md` |
| `flow-nexus-neural` | Neural network training and deployment specialist. Manages distributed neural network training, inference, and model lifecycle using Flow Nexus cloud infrastructure. | `.claude/agents/flow-nexus/neural-network.md` |
| `flow-nexus-payments` | Credit management and billing specialist. Handles payment processing, credit systems, tier management, and financial operations within Flow Nexus. | `.claude/agents/flow-nexus/payments.md` |
| `flow-nexus-sandbox` | E2B sandbox deployment and management specialist. Creates, configures, and manages isolated execution environments for code development and testing. | `.claude/agents/flow-nexus/sandbox.md` |
| `flow-nexus-swarm` | AI swarm orchestration and management specialist. Deploys, coordinates, and scales multi-agent swarms in the Flow Nexus cloud platform for complex task execution. | `.claude/agents/flow-nexus/swarm.md` |
| `flow-nexus-user-tools` | User management and system utilities specialist. Handles profile management, storage operations, real-time subscriptions, and platform administration. | `.claude/agents/flow-nexus/user-tools.md` |
| `flow-nexus-workflow` | Event-driven workflow automation specialist. Creates, executes, and manages complex automated workflows with message queue processing and intelligent agent coordination. | `.claude/agents/flow-nexus/workflow.md` |
| `code-review-swarm` | Deploy specialized AI agents to perform comprehensive, intelligent code reviews that go beyond traditional static analysis | `.claude/agents/github/code-review-swarm.md` |
| `github-modes` | Comprehensive GitHub integration modes for workflow orchestration, PR management, and repository coordination with batch optimization | `.claude/agents/github/github-modes.md` |
| `issue-tracker` | Intelligent issue management and project coordination with automated tracking, progress monitoring, and team coordination | `.claude/agents/github/issue-tracker.md` |
| `multi-repo-swarm` | Cross-repository swarm orchestration for organization-wide automation and intelligent collaboration | `.claude/agents/github/multi-repo-swarm.md` |
| `pr-manager` | Comprehensive pull request management with swarm coordination for automated reviews, testing, and merge workflows | `.claude/agents/github/pr-manager.md` |
| `project-board-sync` | Synchronize AI swarms with GitHub Projects for visual task management, progress tracking, and team coordination | `.claude/agents/github/project-board-sync.md` |
| `release-manager` | Automated release coordination and deployment with ruv-swarm orchestration for seamless version management, testing, and deployment across multiple packages | `.claude/agents/github/release-manager.md` |
| `release-swarm` | Orchestrate complex software releases using AI swarms that handle everything from changelog generation to multi-platform deployment | `.claude/agents/github/release-swarm.md` |
| `repo-architect` | Repository structure optimization and multi-repo management with ruv-swarm coordination for scalable project architecture and development workflows | `.claude/agents/github/repo-architect.md` |
| `swarm-issue` | GitHub issue-based swarm coordination agent that transforms issues into intelligent multi-agent tasks with automatic decomposition and progress tracking | `.claude/agents/github/swarm-issue.md` |
| `swarm-pr` | Pull request swarm management agent that coordinates multi-agent code review, validation, and integration workflows with automated PR lifecycle management | `.claude/agents/github/swarm-pr.md` |
| `sync-coordinator` | Multi-repository synchronization coordinator that manages version alignment, dependency synchronization, and cross-package integration with intelligent swarm orchestration | `.claude/agents/github/sync-coordinator.md` |
| `workflow-automation` | GitHub Actions workflow automation agent that creates intelligent, self-organizing CI/CD pipelines with adaptive multi-agent coordination and automated optimization | `.claude/agents/github/workflow-automation.md` |
| `sublinear-goal-planner` | Goal-Oriented Action Planning (GOAP) specialist that dynamically creates intelligent plans to achieve complex objectives. Uses gaming AI techniques to discover novel solutions b... | `.claude/agents/goal/agent.md` |
| `code-goal-planner` | Code-centric Goal-Oriented Action Planning specialist that creates intelligent plans for software development objectives. Excels at breaking down complex coding tasks into achie... | `.claude/agents/goal/code-goal-planner.md` |
| `goal-planner` | Goal-Oriented Action Planning (GOAP) specialist that dynamically creates intelligent plans to achieve complex objectives. Uses gaming AI techniques to discover novel solutions b... | `.claude/agents/goal/goal-planner.md` |
| `collective-intelligence-coordinator` | Orchestrates distributed cognitive processes across the hive mind, ensuring coherent collective decision-making through memory synchronization and consensus protocols | `.claude/agents/hive-mind/collective-intelligence-coordinator.md` |
| `queen-coordinator` | The sovereign orchestrator of hierarchical hive operations, managing strategic decisions, resource allocation, and maintaining hive coherence through centralized-decentralized h... | `.claude/agents/hive-mind/queen-coordinator.md` |
| `scout-explorer` | Information reconnaissance specialist that explores unknown territories, gathers intelligence, and reports findings to the hive mind through continuous memory updates | `.claude/agents/hive-mind/scout-explorer.md` |
| `swarm-memory-manager` | Manages distributed memory across the hive mind, ensuring data consistency, persistence, and efficient retrieval through advanced caching and synchronization protocols | `.claude/agents/hive-mind/swarm-memory-manager.md` |
| `worker-specialist` | Dedicated task execution specialist that carries out assigned work with precision, continuously reporting progress through memory coordination | `.claude/agents/hive-mind/worker-specialist.md` |
| `safla-neural` | Self-Aware Feedback Loop Algorithm (SAFLA) neural specialist that creates intelligent, memory-persistent AI systems with self-learning capabilities. Combines distributed neural ... | `.claude/agents/neural/safla-neural.md` |
| `Benchmark Suite` | Comprehensive performance benchmarking, regression detection and performance validation | `.claude/agents/optimization/benchmark-suite.md` |
| `Load Balancing Coordinator` | Dynamic task distribution, work-stealing algorithms and adaptive load balancing | `.claude/agents/optimization/load-balancer.md` |
| `Performance Monitor` | Real-time metrics collection, bottleneck analysis, SLA monitoring and anomaly detection | `.claude/agents/optimization/performance-monitor.md` |
| `Resource Allocator` | Adaptive resource allocation, predictive scaling and intelligent capacity planning | `.claude/agents/optimization/resource-allocator.md` |
| `Topology Optimizer` | Dynamic swarm topology reconfiguration and communication pattern optimization | `.claude/agents/optimization/topology-optimizer.md` |
| `agentic-payments` | Multi-agent payment authorization specialist for autonomous AI commerce with cryptographic verification and Byzantine consensus | `.claude/agents/payments/agentic-payments.md` |
| `sona-learning-optimizer` | SONA-powered self-optimizing agent with LoRA fine-tuning and EWC++ memory preservation | `.claude/agents/sona/sona-learning-optimizer.md` |
| `architecture` | SPARC Architecture phase specialist for system design | `.claude/agents/sparc/architecture.md` |
| `pseudocode` | SPARC Pseudocode phase specialist for algorithm design | `.claude/agents/sparc/pseudocode.md` |
| `refinement` | SPARC Refinement phase specialist for iterative improvement | `.claude/agents/sparc/refinement.md` |
| `specification` | SPARC Specification phase specialist for requirements analysis | `.claude/agents/sparc/specification.md` |
| `consensus-coordinator` | Distributed consensus agent that uses sublinear solvers for fast agreement protocols in multi-agent systems. Specializes in Byzantine fault tolerance, voting mechanisms, distrib... | `.claude/agents/sublinear/consensus-coordinator.md` |
| `matrix-optimizer` | Expert agent for matrix analysis and optimization using sublinear algorithms. Specializes in matrix property analysis, diagonal dominance checking, condition number estimation, ... | `.claude/agents/sublinear/matrix-optimizer.md` |
| `pagerank-analyzer` | Expert agent for graph analysis and PageRank calculations using sublinear algorithms. Specializes in network optimization, influence analysis, swarm topology optimization, and l... | `.claude/agents/sublinear/pagerank-analyzer.md` |
| `performance-optimizer` | System performance optimization agent that identifies bottlenecks and optimizes resource allocation using sublinear algorithms. Specializes in computational performance analysis... | `.claude/agents/sublinear/performance-optimizer.md` |
| `trading-predictor` | Advanced financial trading agent that leverages temporal advantage calculations to predict and execute trades before market data arrives. Specializes in using sublinear algorith... | `.claude/agents/sublinear/trading-predictor.md` |
| `adaptive-coordinator` | Dynamic topology switching coordinator with self-organizing swarm patterns and real-time optimization | `.claude/agents/swarm/adaptive-coordinator.md` |
| `hierarchical-coordinator` | Queen-led hierarchical swarm coordination with specialized worker delegation | `.claude/agents/swarm/hierarchical-coordinator.md` |
| `mesh-coordinator` | Peer-to-peer mesh network swarm with distributed decision making and fault tolerance | `.claude/agents/swarm/mesh-coordinator.md` |
| `smart-agent` | Intelligent agent coordination and dynamic spawning specialist | `.claude/agents/templates/automation-smart-agent.md` |
| `swarm-init` | Swarm initialization and topology optimization specialist | `.claude/agents/templates/coordinator-swarm-init.md` |
| `sparc-coder` | Transform specifications into working code with TDD practices | `.claude/agents/templates/implementer-sparc-coder.md` |
| `memory-coordinator` | Manage persistent memory across sessions and facilitate cross-agent memory sharing | `.claude/agents/templates/memory-coordinator.md` |
| `migration-planner` | Comprehensive migration plan for converting commands to agent-based system | `.claude/agents/templates/migration-plan.md` |
| `task-orchestrator` | Central coordination agent for task decomposition, execution planning, and result synthesis | `.claude/agents/templates/orchestrator-task.md` |
| `perf-analyzer` | Performance bottleneck analyzer for identifying and resolving workflow inefficiencies | `.claude/agents/templates/performance-analyzer.md` |
| `sparc-coord` | SPARC methodology orchestrator for systematic development phase coordination | `.claude/agents/templates/sparc-coordinator.md` |
| `production-validator` | Production validation specialist ensuring applications are fully implemented and deployment-ready | `.claude/agents/testing/production-validator.md` |
| `tdd-london-swarm` | TDD London School specialist for mock-driven development within swarm coordination | `.claude/agents/testing/tdd-london-swarm.md` |
| `test-architect` | Testing and quality assurance specialist | `.claude/agents/v3/test-architect.md` |
| `v3-integration-architect` | V3 Integration Architect for deep agentic-flow@alpha integration. Implements ADR-001 to eliminate 10,000+ duplicate lines and build claude-flow as specialized extension rather t... | `.claude/agents/v3/v3-integration-architect.md` |
| `v3-memory-specialist` | V3 Memory Specialist for unifying 6+ memory systems into AgentDB with HNSW indexing. Implements ADR-006 (Unified Memory Service) and ADR-009 (Hybrid Memory Backend) to achieve 1... | `.claude/agents/v3/v3-memory-specialist.md` |
| `v3-performance-engineer` | V3 Performance Engineer for achieving aggressive performance targets. Responsible for 2.49x-7.47x Flash Attention speedup, 150x-12,500x search improvements, and comprehensive be... | `.claude/agents/v3/v3-performance-engineer.md` |
| `v3-queen-coordinator` | V3 Queen Coordinator for 15-agent concurrent swarm orchestration, GitHub issue management, and cross-agent coordination. Implements ADR-001 through ADR-010 with hierarchical mes... | `.claude/agents/v3/v3-queen-coordinator.md` |
| `v3-security-architect` | V3 Security Architect responsible for complete security overhaul, threat modeling, and CVE remediation planning. Addresses critical vulnerabilities CVE-1, CVE-2, CVE-3 and imple... | `.claude/agents/v3/v3-security-architect.md` |
| `system-architect` | Expert agent for system architecture design, patterns, and high-level technical decisions | `.claude/agents/architecture/system-design/arch-system-design.md` |
| `ml-developer` | Specialized agent for machine learning model development, training, and deployment | `.claude/agents/data/ml/data-ml-model.md` |
| `cicd-engineer` | Specialized agent for GitHub Actions CI/CD pipeline creation and optimization | `.claude/agents/devops/ci-cd/ops-cicd-github.md` |
| `api-docs` | Expert agent for creating and maintaining OpenAPI/Swagger documentation | `.claude/agents/documentation/api-docs/docs-api-openapi.md` |
| `mobile-dev` | Expert agent for React Native mobile application development across iOS and Android | `.claude/agents/specialized/mobile/spec-mobile-react-native.md` |
| `adr-architect` | ADR lifecycle manager -- create, index, supersede, and link Architecture Decision Records to code | `plugins/ruflo-adr/agents/adr-architect.md` |
| `nested-coordinator` | Orchestrator that spawns nested sub-agents (up to depth=5) via Claude Code's native Task tool — for deep delegation where context isolation matters more than throughput | `plugins/ruflo-agent/agents/nested-coordinator.md` |
| `nested-leaf` | Leaf-worker template for nested spawn trees — performs one focused task and returns a structured summary. Deliberately does NOT have the Task tool (least-privilege boundary) | `plugins/ruflo-agent/agents/nested-leaf.md` |
| `nested-queen-leaf` | Tier-2 leaf — bottom of a queen-led tree. Deliberately no Task tool (least-privilege), but DOES record trajectory steps, AIDefence-scan its own inbound prompt, and report cost —... | `plugins/ruflo-agent/agents/nested-queen-leaf.md` |
| `nested-queen-researcher` | Tier-2 recursive researcher — nested-researcher's role with HNSW pattern retrieval, AIDefence-gated web content, hive-mind consensus on which followups to pursue, and full traje... | `plugins/ruflo-agent/agents/nested-queen-researcher.md` |
| `nested-queen-reviewer` | Tier-2 recursive reviewer — find-and-verify like nested-reviewer, but with hive-mind byzantine consensus on findings (replaces inline majority voting), AIDefence-screened eviden... | `plugins/ruflo-agent/agents/nested-queen-reviewer.md` |
| `nested-queen` | Heavyweight nested orchestrator — wires Claude Code's depth=5 nesting onto ruflo's hive-mind, swarm, intelligence pipeline, claims/AuthScope, AIDefence, and cost-budget machiner... | `plugins/ruflo-agent/agents/nested-queen.md` |
| `nested-researcher` | Recursive research orchestrator — fans out into sub-research branches when an investigation deepens, keeping each branch in its own context window | `plugins/ruflo-agent/agents/nested-researcher.md` |
| `nested-reviewer` | Recursive review orchestrator — each finding can spawn an adversarial verifier in its own context, so review remains thorough without bloating the top-level reviewer | `plugins/ruflo-agent/agents/nested-reviewer.md` |
| `wasm-specialist` | WASM sandbox specialist for creating, managing, and sharing isolated agent environments | `plugins/ruflo-agent/agents/wasm-specialist.md` |
| `agentdb-specialist` | AgentDB and RuVector specialist for memory operations, HNSW indexing, RaBitQ quantization, and semantic search across the controller bridge | `plugins/ruflo-agentdb/agents/agentdb-specialist.md` |
| `builder` | Produces one bounded artifact for an approved AI team task, such as a document, patch, or plan. Use when a task has a clear deliverable and the user has authorized the workspace... | `plugins/ruflo-ai-team/agents/builder.md` |
| `team-coordinator` | Breaks an approved objective into small tasks with one owner each, tracks dependencies, and keeps the team inside scope and budget. Use when a goal spans several roles. Proposes... | `plugins/ruflo-ai-team/agents/team-coordinator.md` |
| `verifier` | Independently checks AI team results against acceptance criteria and evidence, and flags unsupported claims. Use before a task or run is marked complete. Never approves its own ... | `plugins/ruflo-ai-team/agents/verifier.md` |
| `safety-specialist` | AI safety specialist for threat detection, PII scanning, and adaptive defense training | `plugins/ruflo-aidefence/agents/safety-specialist.md` |
| `autopilot-coordinator` | Autonomous task completion coordinator using /loop and autopilot MCP tools | `plugins/ruflo-autopilot/agents/autopilot-coordinator.md` |
| `browser-agent` | Browser automation agent — drives Playwright via 23 MCP tools, captures every session as an RVF container with a ruvector trajectory, and gates content through AIDefence | `plugins/ruflo-browser/agents/browser-agent.md` |
| `witness-curator` | Maintains the cryptographically-signed witness manifest. Adds new fix entries when shipping a release, regenerates the signed manifest + temporal history, identifies regression-... | `plugins/ruflo-core/agents/witness-curator.md` |
| `cost-analyst` | Tracks token usage per agent and model, computes cost attribution in USD, monitors budgets, and recommends optimizations | `plugins/ruflo-cost-tracker/agents/cost-analyst.md` |
| `daa-specialist` | Dynamic Agentic Architecture specialist for adaptive agents, cognitive patterns, and knowledge sharing | `plugins/ruflo-daa/agents/daa-specialist.md` |
| `domain-modeler` | Domain-Driven Design specialist -- maps domains to bounded contexts, designs aggregate roots, defines domain events, and generates anti-corruption layers | `plugins/ruflo-ddd/agents/domain-modeler.md` |
| `deepseek-architect` | DeepSeek harness architect for ruflo. Surfaces DeepSeek's chat and reasoning models via skills; enforces the ADR-150 removability contract (this plugin as optional augmentation,... | `plugins/ruflo-deepseek-harness/agents/deepseek-architect.md` |
| `docs-writer` | Documentation specialist -- generates and maintains project documentation | `plugins/ruflo-docs/agents/docs-writer.md` |
| `federation-coordinator` | Orchestrates cross-installation agent federation with zero-trust security | `plugins/ruflo-federation/agents/federation-coordinator.md` |
| `deep-researcher` | Multi-source research specialist that gathers, cross-references, and synthesizes information with evidence grading and contradiction resolution | `plugins/ruflo-goals/agents/deep-researcher.md` |
| `dossier-investigator` | Recursive parallel multi-source investigator that fans out across web, memory, knowledge-graph, codebase, and ADR index to build a graph-structured dossier on a seed entity, wit... | `plugins/ruflo-goals/agents/dossier-investigator.md` |
| `horizon-tracker` | Long-horizon objective tracker that persists progress across sessions with milestone checkpoints, drift detection, and adaptive timeline management | `plugins/ruflo-goals/agents/horizon-tracker.md` |
| `intelligence-specialist` | Self-learning intelligence specialist — drives the 4-step pipeline (RETRIEVE → JUDGE → DISTILL → CONSOLIDATE) across 29 MCP tools, coordinates with ruflo-agentdb namespaces, and... | `plugins/ruflo-intelligence/agents/intelligence-specialist.md` |
| `device-coordinator` | Manages Cognitum Seed device fleet as Ruflo agent swarm members with 5-tier trust scoring | `plugins/ruflo-iot-cognitum/agents/device-coordinator.md` |
| `fleet-manager` | Manages device fleets, firmware rollouts, and fleet-wide policies | `plugins/ruflo-iot-cognitum/agents/fleet-manager.md` |
| `telemetry-analyzer` | Analyzes Cognitum Seed device telemetry for anomalies using Z-score detection | `plugins/ruflo-iot-cognitum/agents/telemetry-analyzer.md` |
| `witness-auditor` | Verifies Ed25519 witness chain integrity and detects provenance gaps | `plugins/ruflo-iot-cognitum/agents/witness-auditor.md` |
| `git-specialist` | Git workflow specialist for diff analysis, risk assessment, and PR management | `plugins/ruflo-jujutsu/agents/git-specialist.md` |
| `graph-navigator` | Extracts entities and relations from code and docs, builds knowledge graphs, and traverses them with pathfinder scoring | `plugins/ruflo-knowledge-graph/agents/graph-navigator.md` |
| `loop-worker-coordinator` | Coordinates background worker scheduling, health monitoring, and dispatch across loop and cron execution modes | `plugins/ruflo-loop-workers/agents/loop-worker-coordinator.md` |
| `data-engineer` | Ingests market data feeds, normalizes OHLCV vectors, and performs HNSW-indexed candlestick pattern matching | `plugins/ruflo-market-data/agents/data-engineer.md` |
| `metaharness-architect` | MetaHarness integration architect for ruflo. Surfaces score/genome/mint/mcp-scan/threat-model upstream capabilities via skills; enforces ADR-150 architectural constraint (MetaHa... | `plugins/ruflo-metaharness/agents/metaharness-architect.md` |
| `migration-engineer` | Generates sequential database migrations with up/down pairs, dry-run validation, and rollback safety checks | `plugins/ruflo-migrations/agents/migration-engineer.md` |
| `music-composer` | Writes structured lyrics and a genre/style prompt from a creative brief (genre, mood, language, BPM, theme) for cogmusic's create_production tool | `plugins/ruflo-music/agents/music-composer.md` |
| `music-producer` | Drives the cogmusic MCP pipeline end to end — composes (via music-composer), generates, optionally post-processes (stems/MIDI/master), and reports a real audio_url. Pipeline ent... | `plugins/ruflo-music/agents/music-producer.md` |
| `backtest-engineer` | Backtesting specialist using npx neural-trader Rust/NAPI engine — walk-forward validation, Monte Carlo simulation, parameter optimization. Orthogonal research lane (ADR-126 Phas... | `plugins/ruflo-neural-trader/agents/backtest-engineer.md` |
| `market-analyst` | Market regime detection and technical analysis using npx neural-trader — RSI, MACD, Bollinger Bands, volume profile, regime classification. Pipeline entry point — sends RegimeVe... | `plugins/ruflo-neural-trader/agents/market-analyst.md` |
| `risk-analyst` | Portfolio risk assessment and position sizing using npx neural-trader — VaR/CVaR, Kelly criterion, circuit breakers, correlation monitoring. Pipeline BLOCKING GATE — receives Si... | `plugins/ruflo-neural-trader/agents/risk-analyst.md` |
| `trading-strategist` | Designs and optimizes neural trading strategies using npx neural-trader — LSTM/Transformer models, Rust/NAPI backtesting, Z-score anomaly detection. Pipeline middle stage — rece... | `plugins/ruflo-neural-trader/agents/trading-strategist.md` |
| `observability-engineer` | Implements structured logging, distributed tracing, and metrics collection to correlate agent swarm activity with application telemetry | `plugins/ruflo-observability/agents/observability-engineer.md` |
| `plugin-developer` | Plugin development specialist for scaffolding, validating, and publishing Claude Code plugins | `plugins/ruflo-plugin-creator/agents/plugin-developer.md` |
| `memory-specialist` | Ruflo memory specialist — semantic and keyword retrieval, optional SmartRetrieval ranking, and memory maintenance | `plugins/ruflo-rag-memory/agents/memory-specialist.md` |
| `ruos-host-operator` | Places ruflo swarm agents on the user's own ruOS desktops, streams their output into swarm state, and hands finished work back for review — fleet MCP or per-tenant SSH only | `plugins/ruflo-ruos/agents/ruos-host-operator.md` |
| `vector-engineer` | Vector operations specialist using npx ruvector@0.3.3 — HNSW indexing, adaptive LoRA embeddings, code-graph clustering, hooks routing, brain/SONA, 97 MCP tools. Use when the tas... | `plugins/ruflo-ruvector/agents/vector-engineer.md` |
| `llm-specialist` | RuVLLM specialist for local inference configuration, MicroLoRA fine-tuning, and multi-provider routing | `plugins/ruflo-ruvllm/agents/llm-specialist.md` |
| `session-specialist` | Session persistence specialist for state management, memory transfer, and cross-conversation continuity | `plugins/ruflo-rvf/agents/session-specialist.md` |
| `sparc-orchestrator` | Orchestrates the 5-phase SPARC methodology (Specification, Pseudocode, Architecture, Refinement, Completion) with quality gates between each phase, spawning specialized agents p... | `plugins/ruflo-sparc/agents/sparc-orchestrator.md` |
| `architect` | System architect for designing implementation approaches, API contracts, and module boundaries | `plugins/ruflo-swarm/agents/architect.md` |
| `coordinator` | Swarm coordinator that manages agent lifecycle, task assignment, and anti-drift enforcement | `plugins/ruflo-swarm/agents/coordinator.md` |
| `gaia-benchmark-runner` | Specialized agent for executing GAIA benchmark runs, monitoring progress, and analyzing results | `plugins/ruflo-workflows/agents/gaia-benchmark-runner.md` |
| `gaia-submission-coordinator` | Specialized agent for packaging, signing, and coordinating HAL leaderboard submission of GAIA benchmark results | `plugins/ruflo-workflows/agents/gaia-submission-coordinator.md` |
| `workflow-specialist` | Workflow automation specialist for creating, executing, and managing multi-step processes | `plugins/ruflo-workflows/agents/workflow-specialist.md` |
| `aidefence-guardian` | AI Defense Guardian agent that monitors all agent inputs/outputs for manipulation attempts using AIMDS | `v3/@claude-flow/cli/.claude/agents/v3/aidefence-guardian.md` |
| `claims-authorizer` | V3 Claims-based authorization specialist implementing ADR-010 for fine-grained access control across swarm agents and MCP tools | `v3/@claude-flow/cli/.claude/agents/v3/claims-authorizer.md` |
| `ddd-domain-expert` | V3 Domain-Driven Design specialist for bounded context identification, aggregate design, domain modeling, and ubiquitous language enforcement | `v3/@claude-flow/cli/.claude/agents/v3/ddd-domain-expert.md` |
| `injection-analyst` | Deep analysis specialist for prompt injection and jailbreak attempts with pattern learning | `v3/@claude-flow/cli/.claude/agents/v3/injection-analyst.md` |
| `performance-engineer` | V3 Performance Engineering Agent specialized in Flash Attention optimization (2.49x-7.47x speedup), WASM SIMD acceleration, token usage optimization (50-75% reduction), and comp... | `v3/@claude-flow/cli/.claude/agents/v3/performance-engineer.md` |
| `pii-detector` | Specialized PII detection agent that scans code and data for sensitive information leaks | `v3/@claude-flow/cli/.claude/agents/v3/pii-detector.md` |
| `reasoningbank-learner` | V3 ReasoningBank integration specialist for trajectory tracking, verdict judgment, pattern distillation, and experience replay using HNSW-indexed memory | `v3/@claude-flow/cli/.claude/agents/v3/reasoningbank-learner.md` |
| `security-architect-aidefence` | Enhanced V3 Security Architecture specialist with AIMDS (AI Manipulation Defense System) integration. Combines ReasoningBank learning with real-time prompt injection detection, ... | `v3/@claude-flow/cli/.claude/agents/v3/security-architect-aidefence.md` |
| `security-architect` | V3 Security Architecture specialist with ReasoningBank learning, HNSW threat pattern search, and zero-trust design capabilities | `v3/@claude-flow/cli/.claude/agents/v3/security-architect.md` |

## Same name, more than one file

- `base-template-generator`
  - `.claude/agents/base-template-generator.md`
  - `v3/@claude-flow/cli/.claude/agents/templates/base-template-generator.md`
  - `v3/@claude-flow/mcp/.claude/agents/templates/base-template-generator.md`
- `database-specialist`
  - `.claude/agents/database-specialist.md`
  - `.claude/agents/v3/database-specialist.md`
- `project-coordinator`
  - `.claude/agents/project-coordinator.md`
  - `.claude/agents/v3/project-coordinator.md`
- `python-specialist`
  - `.claude/agents/python-specialist.md`
  - `.claude/agents/v3/python-specialist.md`
- `security-auditor`
  - `.claude/agents/security-auditor.md`
  - `plugins/ruflo-security-audit/agents/security-auditor.md`
  - `v3/@claude-flow/mcp/.claude/agents/v3/security-auditor.md`
- `typescript-specialist`
  - `.claude/agents/typescript-specialist.md`
  - `.claude/agents/v3/typescript-specialist.md`
- `code-analyzer`
  - `.claude/agents/analysis/analyze-code-quality.md`
  - `.claude/agents/analysis/code-review/analyze-code-quality.md`
  - `v3/@claude-flow/cli/.claude/agents/analysis/analyze-code-quality.md`
  - `v3/@claude-flow/mcp/.claude/agents/analysis/analyze-code-quality.md`
  - `v3/@claude-flow/cli/.claude/agents/analysis/code-review/analyze-code-quality.md`
  - `v3/@claude-flow/mcp/.claude/agents/analysis/code-review/analyze-code-quality.md`
- `analyst`
  - `.claude/agents/analysis/code-analyzer.md`
  - `v3/@claude-flow/cli/.claude/agents/analysis/code-analyzer.md`
  - `v3/@claude-flow/mcp/.claude/agents/analysis/code-analyzer.md`
- `byzantine-coordinator`
  - `.claude/agents/consensus/byzantine-coordinator.md`
  - `v3/@claude-flow/cli/.claude/agents/consensus/byzantine-coordinator.md`
  - `v3/@claude-flow/mcp/.claude/agents/consensus/byzantine-coordinator.md`
- `crdt-synchronizer`
  - `.claude/agents/consensus/crdt-synchronizer.md`
  - `v3/@claude-flow/cli/.claude/agents/consensus/crdt-synchronizer.md`
  - `v3/@claude-flow/mcp/.claude/agents/consensus/crdt-synchronizer.md`
- `gossip-coordinator`
  - `.claude/agents/consensus/gossip-coordinator.md`
  - `v3/@claude-flow/cli/.claude/agents/consensus/gossip-coordinator.md`
  - `v3/@claude-flow/mcp/.claude/agents/consensus/gossip-coordinator.md`
- `performance-benchmarker`
  - `.claude/agents/consensus/performance-benchmarker.md`
  - `v3/@claude-flow/cli/.claude/agents/consensus/performance-benchmarker.md`
  - `v3/@claude-flow/mcp/.claude/agents/consensus/performance-benchmarker.md`
- `quorum-manager`
  - `.claude/agents/consensus/quorum-manager.md`
  - `v3/@claude-flow/cli/.claude/agents/consensus/quorum-manager.md`
  - `v3/@claude-flow/mcp/.claude/agents/consensus/quorum-manager.md`
- `raft-manager`
  - `.claude/agents/consensus/raft-manager.md`
  - `v3/@claude-flow/cli/.claude/agents/consensus/raft-manager.md`
  - `v3/@claude-flow/mcp/.claude/agents/consensus/raft-manager.md`
- `security-manager`
  - `.claude/agents/consensus/security-manager.md`
  - `v3/@claude-flow/cli/.claude/agents/consensus/security-manager.md`
  - `v3/@claude-flow/mcp/.claude/agents/consensus/security-manager.md`
- `coder`
  - `.claude/agents/core/coder.md`
  - `plugins/ruflo-core/agents/coder.md`
  - `v3/@claude-flow/mcp/.claude/agents/core/coder.md`
- `planner`
  - `.claude/agents/core/planner.md`
  - `v3/@claude-flow/cli/.claude/agents/core/planner.md`
  - `v3/@claude-flow/mcp/.claude/agents/core/planner.md`
- `researcher`
  - `.claude/agents/core/researcher.md`
  - `plugins/ruflo-ai-team/agents/researcher.md`
  - `plugins/ruflo-core/agents/researcher.md`
  - `plugins/ruflo-ai-team/directory/agents/researcher.md`
  - `v3/@claude-flow/mcp/.claude/agents/core/researcher.md`
- `reviewer`
  - `.claude/agents/core/reviewer.md`
  - `plugins/ruflo-core/agents/reviewer.md`
  - `v3/@claude-flow/mcp/.claude/agents/core/reviewer.md`
- `tester`
  - `.claude/agents/core/tester.md`
  - `plugins/ruflo-testgen/agents/tester.md`
  - `v3/@claude-flow/mcp/.claude/agents/core/tester.md`
- `test-long-runner`
  - `.claude/agents/custom/test-long-runner.md`
  - `v3/@claude-flow/cli/.claude/agents/custom/test-long-runner.md`
  - `v3/@claude-flow/mcp/.claude/agents/custom/test-long-runner.md`
- `backend-dev`
  - `.claude/agents/development/dev-backend-api.md`
  - `.claude/agents/development/backend/dev-backend-api.md`
  - `v3/@claude-flow/cli/.claude/agents/development/dev-backend-api.md`
  - `v3/@claude-flow/mcp/.claude/agents/development/dev-backend-api.md`
  - `v3/@claude-flow/cli/.claude/agents/development/backend/dev-backend-api.md`
  - `v3/@claude-flow/mcp/.claude/agents/development/backend/dev-backend-api.md`
- `flow-nexus-app-store`
  - `.claude/agents/flow-nexus/app-store.md`
  - `v3/@claude-flow/cli/.claude/agents/flow-nexus/app-store.md`
  - `v3/@claude-flow/mcp/.claude/agents/flow-nexus/app-store.md`
- `flow-nexus-auth`
  - `.claude/agents/flow-nexus/authentication.md`
  - `v3/@claude-flow/cli/.claude/agents/flow-nexus/authentication.md`
  - `v3/@claude-flow/mcp/.claude/agents/flow-nexus/authentication.md`
- `flow-nexus-challenges`
  - `.claude/agents/flow-nexus/challenges.md`
  - `v3/@claude-flow/cli/.claude/agents/flow-nexus/challenges.md`
  - `v3/@claude-flow/mcp/.claude/agents/flow-nexus/challenges.md`
- `flow-nexus-neural`
  - `.claude/agents/flow-nexus/neural-network.md`
  - `v3/@claude-flow/cli/.claude/agents/flow-nexus/neural-network.md`
  - `v3/@claude-flow/mcp/.claude/agents/flow-nexus/neural-network.md`
- `flow-nexus-payments`
  - `.claude/agents/flow-nexus/payments.md`
  - `v3/@claude-flow/cli/.claude/agents/flow-nexus/payments.md`
  - `v3/@claude-flow/mcp/.claude/agents/flow-nexus/payments.md`
- `flow-nexus-sandbox`
  - `.claude/agents/flow-nexus/sandbox.md`
  - `v3/@claude-flow/cli/.claude/agents/flow-nexus/sandbox.md`
  - `v3/@claude-flow/mcp/.claude/agents/flow-nexus/sandbox.md`
- `flow-nexus-swarm`
  - `.claude/agents/flow-nexus/swarm.md`
  - `v3/@claude-flow/cli/.claude/agents/flow-nexus/swarm.md`
  - `v3/@claude-flow/mcp/.claude/agents/flow-nexus/swarm.md`
- `flow-nexus-user-tools`
  - `.claude/agents/flow-nexus/user-tools.md`
  - `v3/@claude-flow/cli/.claude/agents/flow-nexus/user-tools.md`
  - `v3/@claude-flow/mcp/.claude/agents/flow-nexus/user-tools.md`
- `flow-nexus-workflow`
  - `.claude/agents/flow-nexus/workflow.md`
  - `v3/@claude-flow/cli/.claude/agents/flow-nexus/workflow.md`
  - `v3/@claude-flow/mcp/.claude/agents/flow-nexus/workflow.md`
- `code-review-swarm`
  - `.claude/agents/github/code-review-swarm.md`
  - `v3/@claude-flow/cli/.claude/agents/github/code-review-swarm.md`
  - `v3/@claude-flow/mcp/.claude/agents/github/code-review-swarm.md`
- `github-modes`
  - `.claude/agents/github/github-modes.md`
  - `v3/@claude-flow/cli/.claude/agents/github/github-modes.md`
  - `v3/@claude-flow/mcp/.claude/agents/github/github-modes.md`
- `issue-tracker`
  - `.claude/agents/github/issue-tracker.md`
  - `v3/@claude-flow/cli/.claude/agents/github/issue-tracker.md`
  - `v3/@claude-flow/mcp/.claude/agents/github/issue-tracker.md`
- `multi-repo-swarm`
  - `.claude/agents/github/multi-repo-swarm.md`
  - `v3/@claude-flow/cli/.claude/agents/github/multi-repo-swarm.md`
  - `v3/@claude-flow/mcp/.claude/agents/github/multi-repo-swarm.md`
- `pr-manager`
  - `.claude/agents/github/pr-manager.md`
  - `.claude/agents/templates/github-pr-manager.md`
  - `v3/@claude-flow/cli/.claude/agents/github/pr-manager.md`
  - `v3/@claude-flow/cli/.claude/agents/templates/github-pr-manager.md`
  - `v3/@claude-flow/mcp/.claude/agents/github/pr-manager.md`
  - `v3/@claude-flow/mcp/.claude/agents/templates/github-pr-manager.md`
- `project-board-sync`
  - `.claude/agents/github/project-board-sync.md`
  - `v3/@claude-flow/cli/.claude/agents/github/project-board-sync.md`
  - `v3/@claude-flow/mcp/.claude/agents/github/project-board-sync.md`
- `release-manager`
  - `.claude/agents/github/release-manager.md`
  - `v3/@claude-flow/cli/.claude/agents/github/release-manager.md`
  - `v3/@claude-flow/mcp/.claude/agents/github/release-manager.md`
- `release-swarm`
  - `.claude/agents/github/release-swarm.md`
  - `v3/@claude-flow/cli/.claude/agents/github/release-swarm.md`
  - `v3/@claude-flow/mcp/.claude/agents/github/release-swarm.md`
- `repo-architect`
  - `.claude/agents/github/repo-architect.md`
  - `v3/@claude-flow/cli/.claude/agents/github/repo-architect.md`
  - `v3/@claude-flow/mcp/.claude/agents/github/repo-architect.md`
- `swarm-issue`
  - `.claude/agents/github/swarm-issue.md`
  - `v3/@claude-flow/cli/.claude/agents/github/swarm-issue.md`
  - `v3/@claude-flow/mcp/.claude/agents/github/swarm-issue.md`
- `swarm-pr`
  - `.claude/agents/github/swarm-pr.md`
  - `v3/@claude-flow/cli/.claude/agents/github/swarm-pr.md`
  - `v3/@claude-flow/mcp/.claude/agents/github/swarm-pr.md`
- `sync-coordinator`
  - `.claude/agents/github/sync-coordinator.md`
  - `v3/@claude-flow/cli/.claude/agents/github/sync-coordinator.md`
  - `v3/@claude-flow/mcp/.claude/agents/github/sync-coordinator.md`
- `workflow-automation`
  - `.claude/agents/github/workflow-automation.md`
  - `v3/@claude-flow/cli/.claude/agents/github/workflow-automation.md`
  - `v3/@claude-flow/mcp/.claude/agents/github/workflow-automation.md`
- `sublinear-goal-planner`
  - `.claude/agents/goal/agent.md`
  - `.claude/agents/reasoning/agent.md`
  - `v3/@claude-flow/cli/.claude/agents/goal/agent.md`
  - `v3/@claude-flow/mcp/.claude/agents/goal/agent.md`
- `goal-planner`
  - `.claude/agents/goal/goal-planner.md`
  - `.claude/agents/reasoning/goal-planner.md`
  - `plugins/ruflo-goals/agents/goal-planner.md`
  - `v3/@claude-flow/mcp/.claude/agents/goal/goal-planner.md`
- `collective-intelligence-coordinator`
  - `.claude/agents/hive-mind/collective-intelligence-coordinator.md`
  - `v3/@claude-flow/cli/.claude/agents/v3/collective-intelligence-coordinator.md`
  - `v3/@claude-flow/mcp/.claude/agents/v3/collective-intelligence-coordinator.md`
- `swarm-memory-manager`
  - `.claude/agents/hive-mind/swarm-memory-manager.md`
  - `v3/@claude-flow/cli/.claude/agents/v3/swarm-memory-manager.md`
  - `v3/@claude-flow/mcp/.claude/agents/v3/swarm-memory-manager.md`
- `Benchmark Suite`
  - `.claude/agents/optimization/benchmark-suite.md`
  - `v3/@claude-flow/cli/.claude/agents/optimization/benchmark-suite.md`
  - `v3/@claude-flow/mcp/.claude/agents/optimization/benchmark-suite.md`
- `Load Balancing Coordinator`
  - `.claude/agents/optimization/load-balancer.md`
  - `v3/@claude-flow/cli/.claude/agents/optimization/load-balancer.md`
  - `v3/@claude-flow/mcp/.claude/agents/optimization/load-balancer.md`
- `Performance Monitor`
  - `.claude/agents/optimization/performance-monitor.md`
  - `v3/@claude-flow/cli/.claude/agents/optimization/performance-monitor.md`
  - `v3/@claude-flow/mcp/.claude/agents/optimization/performance-monitor.md`
- `Resource Allocator`
  - `.claude/agents/optimization/resource-allocator.md`
  - `v3/@claude-flow/cli/.claude/agents/optimization/resource-allocator.md`
  - `v3/@claude-flow/mcp/.claude/agents/optimization/resource-allocator.md`
- `Topology Optimizer`
  - `.claude/agents/optimization/topology-optimizer.md`
  - `v3/@claude-flow/cli/.claude/agents/optimization/topology-optimizer.md`
  - `v3/@claude-flow/mcp/.claude/agents/optimization/topology-optimizer.md`
- `agentic-payments`
  - `.claude/agents/payments/agentic-payments.md`
  - `v3/@claude-flow/cli/.claude/agents/payments/agentic-payments.md`
  - `v3/@claude-flow/mcp/.claude/agents/payments/agentic-payments.md`
- `sona-learning-optimizer`
  - `.claude/agents/sona/sona-learning-optimizer.md`
  - `v3/@claude-flow/cli/.claude/agents/sona/sona-learning-optimizer.md`
  - `v3/@claude-flow/mcp/.claude/agents/sona/sona-learning-optimizer.md`
- `architecture`
  - `.claude/agents/sparc/architecture.md`
  - `v3/@claude-flow/cli/.claude/agents/sparc/architecture.md`
  - `v3/@claude-flow/mcp/.claude/agents/sparc/architecture.md`
- `pseudocode`
  - `.claude/agents/sparc/pseudocode.md`
  - `v3/@claude-flow/cli/.claude/agents/sparc/pseudocode.md`
  - `v3/@claude-flow/mcp/.claude/agents/sparc/pseudocode.md`
- `refinement`
  - `.claude/agents/sparc/refinement.md`
  - `v3/@claude-flow/cli/.claude/agents/sparc/refinement.md`
  - `v3/@claude-flow/mcp/.claude/agents/sparc/refinement.md`
- `specification`
  - `.claude/agents/sparc/specification.md`
  - `v3/@claude-flow/cli/.claude/agents/sparc/specification.md`
  - `v3/@claude-flow/mcp/.claude/agents/sparc/specification.md`
- `consensus-coordinator`
  - `.claude/agents/sublinear/consensus-coordinator.md`
  - `v3/@claude-flow/cli/.claude/agents/sublinear/consensus-coordinator.md`
  - `v3/@claude-flow/mcp/.claude/agents/sublinear/consensus-coordinator.md`
- `matrix-optimizer`
  - `.claude/agents/sublinear/matrix-optimizer.md`
  - `v3/@claude-flow/cli/.claude/agents/sublinear/matrix-optimizer.md`
  - `v3/@claude-flow/mcp/.claude/agents/sublinear/matrix-optimizer.md`
- `pagerank-analyzer`
  - `.claude/agents/sublinear/pagerank-analyzer.md`
  - `v3/@claude-flow/cli/.claude/agents/sublinear/pagerank-analyzer.md`
  - `v3/@claude-flow/mcp/.claude/agents/sublinear/pagerank-analyzer.md`
- `performance-optimizer`
  - `.claude/agents/sublinear/performance-optimizer.md`
  - `v3/@claude-flow/cli/.claude/agents/sublinear/performance-optimizer.md`
  - `v3/@claude-flow/mcp/.claude/agents/sublinear/performance-optimizer.md`
- `trading-predictor`
  - `.claude/agents/sublinear/trading-predictor.md`
  - `v3/@claude-flow/cli/.claude/agents/sublinear/trading-predictor.md`
  - `v3/@claude-flow/mcp/.claude/agents/sublinear/trading-predictor.md`
- `adaptive-coordinator`
  - `.claude/agents/swarm/adaptive-coordinator.md`
  - `v3/@claude-flow/cli/.claude/agents/swarm/adaptive-coordinator.md`
  - `v3/@claude-flow/mcp/.claude/agents/swarm/adaptive-coordinator.md`
- `hierarchical-coordinator`
  - `.claude/agents/swarm/hierarchical-coordinator.md`
  - `v3/@claude-flow/cli/.claude/agents/swarm/hierarchical-coordinator.md`
  - `v3/@claude-flow/mcp/.claude/agents/swarm/hierarchical-coordinator.md`
- `mesh-coordinator`
  - `.claude/agents/swarm/mesh-coordinator.md`
  - `v3/@claude-flow/cli/.claude/agents/swarm/mesh-coordinator.md`
  - `v3/@claude-flow/mcp/.claude/agents/swarm/mesh-coordinator.md`
- `smart-agent`
  - `.claude/agents/templates/automation-smart-agent.md`
  - `v3/@claude-flow/cli/.claude/agents/templates/automation-smart-agent.md`
  - `v3/@claude-flow/mcp/.claude/agents/templates/automation-smart-agent.md`
- `swarm-init`
  - `.claude/agents/templates/coordinator-swarm-init.md`
  - `v3/@claude-flow/cli/.claude/agents/templates/coordinator-swarm-init.md`
  - `v3/@claude-flow/mcp/.claude/agents/templates/coordinator-swarm-init.md`
- `sparc-coder`
  - `.claude/agents/templates/implementer-sparc-coder.md`
  - `v3/@claude-flow/cli/.claude/agents/templates/implementer-sparc-coder.md`
  - `v3/@claude-flow/mcp/.claude/agents/templates/implementer-sparc-coder.md`
- `memory-coordinator`
  - `.claude/agents/templates/memory-coordinator.md`
  - `v3/@claude-flow/cli/.claude/agents/templates/memory-coordinator.md`
  - `v3/@claude-flow/mcp/.claude/agents/templates/memory-coordinator.md`
- `task-orchestrator`
  - `.claude/agents/templates/orchestrator-task.md`
  - `v3/@claude-flow/cli/.claude/agents/templates/orchestrator-task.md`
  - `v3/@claude-flow/mcp/.claude/agents/templates/orchestrator-task.md`
- `perf-analyzer`
  - `.claude/agents/templates/performance-analyzer.md`
  - `v3/@claude-flow/cli/.claude/agents/templates/performance-analyzer.md`
  - `v3/@claude-flow/mcp/.claude/agents/templates/performance-analyzer.md`
- `sparc-coord`
  - `.claude/agents/templates/sparc-coordinator.md`
  - `v3/@claude-flow/cli/.claude/agents/templates/sparc-coordinator.md`
  - `v3/@claude-flow/mcp/.claude/agents/templates/sparc-coordinator.md`
- `production-validator`
  - `.claude/agents/testing/production-validator.md`
  - `.claude/agents/testing/validation/production-validator.md`
  - `v3/@claude-flow/cli/.claude/agents/testing/production-validator.md`
  - `v3/@claude-flow/mcp/.claude/agents/testing/production-validator.md`
- `tdd-london-swarm`
  - `.claude/agents/testing/tdd-london-swarm.md`
  - `.claude/agents/testing/unit/tdd-london-swarm.md`
  - `v3/@claude-flow/cli/.claude/agents/testing/tdd-london-swarm.md`
  - `v3/@claude-flow/mcp/.claude/agents/testing/tdd-london-swarm.md`
- `v3-integration-architect`
  - `.claude/agents/v3/v3-integration-architect.md`
  - `v3/@claude-flow/cli/.claude/agents/v3/v3-integration-architect.md`
  - `v3/@claude-flow/mcp/.claude/agents/v3/v3-integration-architect.md`
- `system-architect`
  - `.claude/agents/architecture/system-design/arch-system-design.md`
  - `v3/@claude-flow/cli/.claude/agents/architecture/arch-system-design.md`
  - `v3/@claude-flow/mcp/.claude/agents/architecture/arch-system-design.md`
  - `v3/@claude-flow/cli/.claude/agents/architecture/system-design/arch-system-design.md`
  - `v3/@claude-flow/mcp/.claude/agents/architecture/system-design/arch-system-design.md`
- `ml-developer`
  - `.claude/agents/data/ml/data-ml-model.md`
  - `v3/@claude-flow/cli/.claude/agents/data/data-ml-model.md`
  - `v3/@claude-flow/mcp/.claude/agents/data/data-ml-model.md`
  - `v3/@claude-flow/cli/.claude/agents/data/ml/data-ml-model.md`
  - `v3/@claude-flow/mcp/.claude/agents/data/ml/data-ml-model.md`
- `cicd-engineer`
  - `.claude/agents/devops/ci-cd/ops-cicd-github.md`
  - `v3/@claude-flow/cli/.claude/agents/devops/ops-cicd-github.md`
  - `v3/@claude-flow/mcp/.claude/agents/devops/ops-cicd-github.md`
  - `v3/@claude-flow/cli/.claude/agents/devops/ci-cd/ops-cicd-github.md`
  - `v3/@claude-flow/mcp/.claude/agents/devops/ci-cd/ops-cicd-github.md`
- `api-docs`
  - `.claude/agents/documentation/api-docs/docs-api-openapi.md`
  - `v3/@claude-flow/cli/.claude/agents/documentation/docs-api-openapi.md`
  - `v3/@claude-flow/mcp/.claude/agents/documentation/docs-api-openapi.md`
  - `v3/@claude-flow/cli/.claude/agents/documentation/api-docs/docs-api-openapi.md`
  - `v3/@claude-flow/mcp/.claude/agents/documentation/api-docs/docs-api-openapi.md`
- `mobile-dev`
  - `.claude/agents/specialized/mobile/spec-mobile-react-native.md`
  - `v3/@claude-flow/cli/.claude/agents/specialized/spec-mobile-react-native.md`
  - `v3/@claude-flow/mcp/.claude/agents/specialized/spec-mobile-react-native.md`
  - `v3/@claude-flow/cli/.claude/agents/specialized/mobile/spec-mobile-react-native.md`
  - `v3/@claude-flow/mcp/.claude/agents/specialized/mobile/spec-mobile-react-native.md`
- `adr-architect`
  - `plugins/ruflo-adr/agents/adr-architect.md`
  - `v3/@claude-flow/mcp/.claude/agents/v3/adr-architect.md`
- `builder`
  - `plugins/ruflo-ai-team/agents/builder.md`
  - `plugins/ruflo-ai-team/directory/agents/builder.md`
- `team-coordinator`
  - `plugins/ruflo-ai-team/agents/team-coordinator.md`
  - `plugins/ruflo-ai-team/directory/agents/team-coordinator.md`
- `verifier`
  - `plugins/ruflo-ai-team/agents/verifier.md`
  - `plugins/ruflo-ai-team/directory/agents/verifier.md`
- `memory-specialist`
  - `plugins/ruflo-rag-memory/agents/memory-specialist.md`
  - `v3/@claude-flow/mcp/.claude/agents/v3/memory-specialist.md`
- `sparc-orchestrator`
  - `plugins/ruflo-sparc/agents/sparc-orchestrator.md`
  - `v3/@claude-flow/mcp/.claude/agents/v3/sparc-orchestrator.md`
- `aidefence-guardian`
  - `v3/@claude-flow/cli/.claude/agents/v3/aidefence-guardian.md`
  - `v3/@claude-flow/mcp/.claude/agents/v3/aidefence-guardian.md`
- `claims-authorizer`
  - `v3/@claude-flow/cli/.claude/agents/v3/claims-authorizer.md`
  - `v3/@claude-flow/mcp/.claude/agents/v3/claims-authorizer.md`
- `ddd-domain-expert`
  - `v3/@claude-flow/cli/.claude/agents/v3/ddd-domain-expert.md`
  - `v3/@claude-flow/mcp/.claude/agents/v3/ddd-domain-expert.md`
- `injection-analyst`
  - `v3/@claude-flow/cli/.claude/agents/v3/injection-analyst.md`
  - `v3/@claude-flow/mcp/.claude/agents/v3/injection-analyst.md`
- `performance-engineer`
  - `v3/@claude-flow/cli/.claude/agents/v3/performance-engineer.md`
  - `v3/@claude-flow/mcp/.claude/agents/v3/performance-engineer.md`
- `pii-detector`
  - `v3/@claude-flow/cli/.claude/agents/v3/pii-detector.md`
  - `v3/@claude-flow/mcp/.claude/agents/v3/pii-detector.md`
- `reasoningbank-learner`
  - `v3/@claude-flow/cli/.claude/agents/v3/reasoningbank-learner.md`
  - `v3/@claude-flow/mcp/.claude/agents/v3/reasoningbank-learner.md`
- `security-architect-aidefence`
  - `v3/@claude-flow/cli/.claude/agents/v3/security-architect-aidefence.md`
  - `v3/@claude-flow/mcp/.claude/agents/v3/security-architect-aidefence.md`
- `security-architect`
  - `v3/@claude-flow/cli/.claude/agents/v3/security-architect.md`
  - `v3/@claude-flow/mcp/.claude/agents/v3/security-architect.md`
