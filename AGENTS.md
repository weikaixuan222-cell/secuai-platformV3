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

## Directory Plan
- apps/web: admin dashboard
- apps/api: main backend API
- services/ai-analyzer: AI risk scoring service
- packages/shared: shared types and utilities

## Coding Rules
1. Explain the plan before major implementation
2. Create minimal runnable code first
3. Do not add unnecessary dependencies
4. Add basic validation for all external input
5. Add simple tests for core logic where possible
6. After each task, summarize:
   - what was implemented
   - why it was designed that way
   - what should be done next

## Verification And Completion Rules
After each task, Codex must run the smallest relevant verification for the changed module before considering the task complete.

Rules:
1. Do not stop at code generation only.
2. Always verify the changed part when feasible.
3. Prefer focused verification over full-project verification unless the task is integration-related.
4. If verification cannot be executed because of environment limits, state the exact reason clearly.
5. A completion summary must always include:
   - implemented changes
   - commands run for verification
   - pass/fail result
   - remaining unverified risks

Minimum checks by area:
- Backend changes:
  - typecheck
  - build
  - endpoint smoke test when routes changed
- Frontend changes:
  - typecheck
  - build
  - minimal page/flow smoke test when feasible
- Database changes:
  - schema or migration apply
- Detection/security logic changes:
  - run a sample detection flow and confirm expected event generation
- AI analyzer changes:
  - run the analyze endpoint with sample payloads and confirm expected scoring behavior

Definition of done:
A task is only done when both implementation and relevant verification are completed and reported.

## Refactoring And Bug Fix Rules
When fixing bugs or technical debt:
1. Fix root causes in the original implementation whenever possible.
2. Do not add outer patch layers to hide flawed internal logic.
3. Do not keep parallel long-term implementations for the same responsibility.
4. Temporary compatibility code is only allowed when required for migration, and must include a clear cleanup path.
5. Prefer replacing incorrect structures over wrapping them.
6. Every bug fix task must include:
   - root cause analysis
   - files changed
   - verification steps
   - remaining risks

## Security-Sensitive Rules
For authentication, session handling, key storage, detection permissions, and event generation:
1. Never keep insecure legacy logic once a secure replacement is implemented unless a migration step requires it.
2. Secrets must not be stored in plaintext when hashing is feasible.
3. Authorization checks must be enforced in the main flow, not documented as future work.
4. Detection and scoring flows must fail safely and degrade gracefully.

## Integration Rules
For detection and AI scoring:
1. request_logs must be processed first
2. attack_events must be created before AI scoring
3. AI scoring must never block attack_events creation
4. AI failures must degrade safely
5. Do not create a parallel detection pipeline

## AI Scoring Contract
For the current MVP:
- model_name must be heuristic-analyzer
- model_version must be v1
- reasons must retain array semantics
- explanation is human-readable text
- raw_response or factors should preserve structured analyzer output

Every completion report must include:
1. commands run
2. pass/fail result
3. what remains unverified

## Current Priorities
1. Complete backend integration from detection to AI scoring
2. Persist AI analysis results into ai_risk_results
3. Verify the full backend flow:
   request_logs -> attack_events -> ai_risk_results
4. Add backend query APIs needed for later dashboard use
5. Do not start frontend dashboard work until the backend flow is complete and verified