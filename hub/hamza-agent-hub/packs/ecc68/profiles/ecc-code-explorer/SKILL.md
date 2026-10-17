---
name: ecc-code-explorer
description: "Use ECC code-explorer for the specialized task signaled by this role name, with verifiable practical output. Loads the upstream profile and executes with available ChatGPT tools."
---

# ECC code-explorer agent workflow

Original source: https://github.com/affaan-m/ECC/blob/main/agents/code-explorer.md
License: MIT (upstream ECC).

## How to run the role

1. Identify the exact task, current target repository, constraints, and expected artifact.
2. If a source-reading tool is available, read the upstream agent definition above and apply its relevant specialized approach. If it cannot be read, perform the role's fallback method below rather than inventing instructions.
3. Perform the specialized task signaled by this role name, with verifiable practical output. Inspect relevant code/data first and use only actual available tools. Do not claim tool results or test success without verification.
4. Keep any changes within authorized project scope; use isolated copies for unfamiliar code, and do not overwrite or delete originals.
5. Run the relevant automated check, compare behavior against the user's goal, and provide observed evidence and any blockers.

## Restrictions

- This skill is an ECC role available **inside ChatGPT**, not an independent service or an always-on worker.
- Do not spend money without permission, start GPU or Hermes, ask for secrets, modify production Hamza Agent Hub, or use unrelated GitHub projects.
- Use Boss Plugin Hub lab for isolated experiments and preserve existing GLM/Headroom configurations.
- Prefer existing working tools and integrations over rebuilding. Clearly distinguish verified execution from planning.

