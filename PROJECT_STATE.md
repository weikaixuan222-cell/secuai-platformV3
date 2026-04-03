# PROJECT_STATE.md

## Project Name
SecuAI small-business website protection platform

## Current Stage
Backend and middleware stage.
Not in frontend stage yet.
Do not start frontend unless explicitly requested.

## Core Goal
Build an AI-driven website protection platform for small businesses with:
- request log ingestion
- attack detection
- AI risk scoring
- site-level protection policies
- blocked entities
- lightweight protection enforcement
- site-side middleware integration

## Stable Main Pipeline
request_logs -> detection -> attack_events -> ai_risk_results

This main pipeline must be preserved.

## Already Implemented
1. User registration and login
2. Tenant/company management
3. Site onboarding
4. Request log ingestion
5. Basic attack detection
6. AI risk scoring service
7. Site-level security policies
8. Blocked entities management
9. monitor / protect enforcement in request-log ingress flow
10. POST /api/v1/protection/check
11. packages/site-middleware
12. allow / monitor / block handling
13. fail-open behavior
14. monitor-hit async request_logs reporting from middleware

## Current Protection Behavior
### monitor
- request continues
- may asynchronously report request_logs
- downstream detection and AI pipeline should still work

### protect
- request may be blocked
- consistent error structure required
- reasons must be explicit

### fail-open
- if platform unavailable or timeout
- allow request
- mark failOpenReason
- do not block the site request

## Current Integration Path
site request
-> site middleware
-> POST /api/v1/protection/check
-> allow / monitor / block
-> if monitor and reporting enabled: async POST /api/v1/request-logs
-> detection
-> attack_events
-> ai_risk_results

## Current Priority
Build a minimal end-to-end demo flow for:
site request -> protection/check -> monitor async request_logs -> detection -> attack_events -> ai_risk_results

## Do Not Do Yet
- frontend pages
- reverse proxy
- full traffic gateway
- complex queue system
- distributed rate limiting
- complex SDK publishing
- heavy refactor of current pipeline

## Expected Next Task
Add a minimal end-to-end demo script that:
1. simulates a real site request
2. runs through middleware protection check
3. triggers monitor async request_logs reporting
4. triggers detection
5. queries attack_events
6. queries ai_risk_results

## Environment Notes
Use the currently working local database/API configuration already validated in the repo.
Keep config sources consistent across dev, schema apply, and test.

## Coding Constraint
Prefer minimal runnable changes.
Reuse existing API and middleware.
Do not duplicate core logic.