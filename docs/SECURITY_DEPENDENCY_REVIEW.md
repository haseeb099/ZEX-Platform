# Security dependency review

Generated during ZEX-31 platform ops/security hardening gate (`harden/platform-ops-security`).

## Audit counts (npm audit)

| Severity | Count |
|----------|------:|
| Critical | 1 |
| High | 10 |
| Moderate | 13 |
| Low | 3 |
| **Total** | **27** |

Command: `npm audit --json` after `npm audit fix` (no `--force`).

## Actions taken

- Ran `npm audit fix` — **no safe runtime patches applied** (remaining fixes require NestJS 12 / major semver bumps).
- **Did not** run `npm audit fix --force` (would upgrade `@nestjs/platform-fastify`, `@nestjs/core`, `@nestjs/cli`, etc.).

## Triage summary

| Package | Severity | Direct/Transitive | Runtime/Dev | Fix available? | Action taken | Deferred reason |
|---------|----------|-------------------|-------------|----------------|--------------|-----------------|
| `@fastify/middie` | critical | transitive (`@nestjs/platform-fastify`) | runtime | major only | documented | Requires NestJS 12 / platform-fastify major upgrade |
| `@fastify/static` | high | direct | runtime (Swagger static) | major only | documented | Bundled with NestJS 11 stack; major bump risk |
| `fastify` | high | transitive | runtime | major only | documented | NestJS 12 platform-fastify dependency chain |
| `find-my-way` | high | transitive | runtime | major only | documented | Fastify router; fixed in NestJS 12 chain |
| `@nestjs/core` | moderate | direct | runtime | major only | documented | Injection advisory; Nest 12 patch |
| `@nestjs/common` / `file-type` | moderate | direct/transitive | runtime | minor patch flagged | documented | Patch tied to Nest minor line |
| `lodash` | high | transitive (`@nestjs/config`) | runtime | major only | documented | lodash in config; Nest 12 config upgrade |
| `js-yaml` | high | transitive (`@nestjs/swagger`) | runtime (OpenAPI) | major only | documented | Swagger static/docs path |
| `glob`, `webpack`, `tmp`, `picomatch`, `ajv` | high/moderate | transitive | **dev** (`@nestjs/cli`) | major only | documented | Build tooling only; not in production container runtime |
| `@angular-devkit/*` | moderate | transitive | dev | major only | documented | Nest CLI scaffolding |

## Exploitability notes (this application)

- **Runtime HTTP surface:** `@fastify/middie` / `fastify` / `find-my-way` advisories affect the Fastify HTTP stack. ZEX-Platform uses `@nestjs/platform-fastify` for webhooks and admin APIs. Mitigation until upgrade: deploy behind trusted reverse proxy, disable untrusted `X-Forwarded-*` at edge, no path-scoped middie plugins in use today.
- **Swagger static (`@fastify/static`):** exposed only when Swagger UI is enabled; ensure production disables public docs if not required.
- **Dev-only chain:** CLI/webpack/glob/tmp findings affect local `nest build` / CI compile, not the running worker/API process.

## Re-run before staging

```bash
npm audit --json
```

Update this file when NestJS 12 upgrade is scheduled or when safe patches land on the current major line.

## Dependencies changed in this PR

None (audit-only triage; no dependency version bumps).
