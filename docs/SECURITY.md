# Security model

## Threat model

Primary risks include cross-tenant data access, stolen sessions, malicious file uploads, oversized/expensive analysis requests, service-role leakage, mass assignment, forged tenant IDs and unsafe external file access.

## Controls included

- PostgreSQL RLS on every exposed business table.
- Anonymous privileges revoked from business tables.
- Tenant identity is derived from authenticated membership, not trusted from request JSON.
- Role checks for estimator/admin/owner actions.
- Service-role key is server/worker only.
- Private drawing bucket with tenant-path policies.
- MIME allow-list and 25 MB upload cap.
- Same-origin mutation checks.
- Distributed database-backed API rate limits.
- Zod validation on public JSON endpoints.
- Content Security Policy, clickjacking prevention and browser permission restrictions.
- Queue work occurs outside the user request.
- Worker job claim uses database row locking.
- Extraction result stores evidence/confidence to support review.
- Quote versions and audit-log schema are included for traceability.

## Required production controls before commercial launch

1. Enable MFA for owners/admins.
2. Configure verified company-domain email and password policy.
3. Store secrets in deployment secret management; never commit `.env`.
4. Put extraction API on private networking or an authenticated gateway.
5. Enable database backups + point-in-time recovery.
6. Enable storage malware scanning if arbitrary customer files are accepted beyond the current PDF/JPG/PNG allow-list.
7. Add Sentry/OpenTelemetry or equivalent centralized observability.
8. Add WAF/bot protection at the edge.
9. Run dependency/SAST/secret scanning in CI.
10. Commission an external penetration test before enterprise rollout.
11. Define data retention/deletion and legal terms per target geography.
12. Rotate service keys and HMAC secrets periodically.

## Authorization rule

Never authorize with only `tenant_id` supplied by the client. The database policies call `auth.uid()` and verify an active membership for the row's tenant.
