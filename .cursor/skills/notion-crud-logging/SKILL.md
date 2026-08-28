---
name: notion-crud-logging
description: >-
  Log every Create/Read/Update/Delete/Decision for ZEX Connect into the Notion
  Activity Log (CRUD) database. Use whenever tasks, code, config, tenants,
  webhooks, docs, or deploys change state.
---

# Notion CRUD Logging

## Database

https://app.notion.com/p/0ecfc1f14b9f4d329f6a0014ba9a857e

## Required fields

- **Entry** — short title
- **Action** — Create | Read | Update | Delete | Decision | Note | Deploy
- **Entity** — Task | Code | Config | Tenant | Webhook | Docs | Database | Deploy | Rule/Skill
- **Details** — what changed and why (include before→after for Update)
- **Actor** — human or agent name
- **Related Task ID** — when tied to a backlog item

## Rule

No silent Create/Update/Delete on this project. If you changed Notion or shipped code, log it.
