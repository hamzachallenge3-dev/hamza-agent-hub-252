# Target Architecture — Capability Plugin Pack, not a standalone crawler

## Core principle
Claude is NOT being asked to run a million-source crawl as a permanent service.
Claude must BUILD installable/reusable Plugins/Skills/Tools that another AI runtime can invoke later.

The runtime actor will be ChatGPT, Hermes, Claude, or another compatible agent after installation.

## Deliverable shape
Create one meta-plugin plus modular skills/tools:

### Meta plugin
`cross-forge-intelligence`
Purpose: route a user/agent query to the correct platform/search/intelligence capability.

### Recommended modules
- forge-detect
- github-intelligence
- gitlab-intelligence
- bitbucket-intelligence
- azure-devops-intelligence
- codeberg-forgejo-gitea-intelligence
- sourceforge-intelligence
- launchpad-intelligence
- generic-forge-search
- repo-deep-search
- repo-url-tricks
- repo-code-search
- repo-history-archaeology
- repo-fork-mining
- repo-dependency-mining
- repo-related-projects
- agent-discovery
- skill-discovery
- mcp-discovery
- tool-discovery
- prompt-workflow-discovery
- capability-extractor
- capability-deduplicator
- provenance-license-check
- source-quality-ranker
- skill-pack-builder

## Runtime behavior
When installed, the AI should be able to ask:
- search 20 forges for browser agents
- find SKILL.md files
- find MCP servers
- inspect one repo deeply
- expand one repo through forks/dependencies/contributors
- extract reusable capabilities
- compare implementations
- build a curated skill pack

The plugin performs work only when invoked. No always-running daemon is required.

## Required plugin outputs
For each capability provide:
- manifest / metadata
- clear tool schema
- deterministic input/output contract
- SKILL.md or equivalent behavioral instructions
- implementation wrapper if external API/tool access is needed
- test fixtures
- install instructions
- permission requirements
- supported/unsupported platforms
- provenance rules
- error handling / rate-limit behavior

## Portability
Prefer portable design:
1. Generic SKILL.md instructions
2. MCP-compatible tool schemas where useful
3. OpenAPI/JSON-schema tool contracts where useful
4. Small adapters instead of one monolith

Do not lock the design to one model vendor unless unavoidable.
