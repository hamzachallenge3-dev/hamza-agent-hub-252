# Security model

This release is a single-owner lab runtime. HTTP requires a 24+ character Bearer token; the Worker enforces a separate 32+ character URL-safe path capability and forwards a private origin token. Never publish either. No multi-tenant identity/authorization is implemented; public store distribution requires it.

Origins compare exactly. Loopback binds retain SDK DNS-rebinding checks. Requests are size/rate limited; model calls and proxy fetches have deadlines. MCP health uses a fixed host and no secret. User-supplied HTML and JSON tools never fetch or execute content. Paid services and arbitrary shell tools are absent. Operators must configure model endpoints using free credentials.

Workspace operations reject traversal, absolute paths, symlinks, oversized reads/writes and regex search backtracking. Model roles restrict tool access. Paths are checked at use time, but the filesystem must not be concurrently writable by an untrusted OS user: these checks are not an openat-based race-proof sandbox. Keep workspace volumes private. Task data can contain personal information; protect SQLite/workspace backups and implement your retention policy. Runtime outputs/artifacts/events redact recognized secrets; redaction is defense in depth, not permission to store secrets in prompts.

Queue concurrency is for one Node process. Multiple replicas sharing SQLite are unsupported. Dispatch uses durable idempotency keys and prevents orchestrator recursion. Parent cancellation does not cancel already queued specialist children; cancel each child explicitly. Offline completion means scaffold/assignment creation, not a completed live AI review.

Use vulnerability and secret scans before releases. No `.env`, dependency trees, app binding, symlinks or known secret patterns enter ZIP exports. A public package rejects secret-bearing endpoint paths. Rotate private capability and origin tokens after suspected exposure. Disable proxy/access logs and do not record full URLs.
