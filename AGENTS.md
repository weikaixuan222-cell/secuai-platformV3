# AGENTS.md

## Project
Build an AI-driven website security protection platform for small businesses.

## Goal
Allow small business websites to connect to this platform for traffic inspection, attack detection, AI-based risk scoring, and security event visualization.

## MVP Scope
The first version only needs:
1. User registration and login
2. Tenant/company management
3. Site onboarding
4. Request log ingestion
5. Basic attack event detection
6. AI risk scoring service
7. Admin dashboard for logs and attack events

## Tech Stack
- Frontend: Next.js + TypeScript
- Backend: Node.js + TypeScript
- AI service: Python + FastAPI
- Database: PostgreSQL
- Cache: Redis
- DevOps: Docker Compose

## Architecture Rules
1. Use a modular monorepo structure
2. Keep MVP simple and runnable
3. Prefer readable code over clever abstractions
4. Security-related logic must be commented
5. AI analysis logic must be isolated in its own service
6. All services must have clear environment variable examples
7. Every module must include run instructions

## Current Product Direction
1. The project is currently in the phase from a log-ingestion security analysis platform toward a platform with minimal enforcement capability.
2. Do not redesign it into a full reverse proxy or full traffic gateway at this stage.
3. Keep the main chain stable:
   - request_logs
   - detection
   - attack_events
   - ai_risk_results
4. Prioritize demonstrable MVP value over heavy infrastructure upgrades.

## Directory Plan
- apps/web: admin dashboard
- apps/api: main backend API
- services/ai-analyzer: AI risk analysis service
- packages/shared: shared types and utilities
- packages/site-middleware: site-side protection middleware

## Working Rules for Codex / Antigravity
1. Read this file before making changes.
2. Follow MVP-first scope control.
3. Do not change API contracts unless explicitly required.
4. Prefer small, verifiable iterations.
5. When entering frontend work, prioritize:
   - clear user-visible copy
   - loading / error / empty / recover states
   - accessibility semantics
   - predictable navigation and URL state
   - smoke coverage for critical flows
6. Reuse existing helpers and components whenever possible.
7. Do not invent backend fields that do not exist.
8. Keep dev-only probes safe by default:
   - enabled by default only in dev when intended
   - off by default in production
   - production enablement must require an explicit environment variable

## Language and Documentation Rules
1. All newly added or updated Markdown documentation must be written in Chinese.
2. All newly added or updated code comments must be written in Chinese.
3. When revising an existing file, convert touched English comments and touched Markdown content to Chinese unless there is a strong technical reason not to.
4. User-facing explanatory text in docs, demo guides, runbooks, and README files should default to Chinese.
5. Keep identifiers, API paths, protocol fields, database table names, error codes, and other technical contract values unchanged unless the task explicitly requires changing them.
6. For bilingual or mixed-language files, prefer consolidating them into Chinese during active edits rather than leaving partial English behind.

## Validation Rules
1. Every meaningful change should include validation.
2. Prefer:
   - typecheck
   - build
   - targeted smoke
3. If something cannot be fully smoke-tested yet, state the remaining risk clearly.

## PROJECT_STATE.md Rules
Whenever a task modifies PROJECT_STATE.md, update it in a concise way.

Requirements:
1. Keep PROJECT_STATE.md short and scannable.
2. Only keep durable, high-value project state.
3. Do not keep long historical narration.
4. Do not duplicate implementation details that are already obvious from code or README.
5. Prefer compact sections and bullet points over long prose.
6. Keep:
   - current project stage
   - confirmed architecture direction
   - current web status
   - latest validated capabilities
   - current blockers / risks
   - next recommended step
7. Remove:
   - stale intermediate notes
   - repeated validation logs
   - overly detailed file-by-file history
8. After each successful task that changes PROJECT_STATE.md, rewrite it into the latest concise state instead of only appending more text.
9. PROJECT_STATE.md content should be written in Chinese.

## Delivery Rules
After completing a task, report:
1. Design approach
2. What was changed
3. Validation commands
4. Validation results
5. Whether AGENTS.md needs changes
6. Whether PROJECT_STATE.md needs changes