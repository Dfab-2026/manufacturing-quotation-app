# Backup and recovery policy

## Data classes
- PostgreSQL: tenants, users' memberships, RFQs, costing, revisions, approvals, audit data and masters.
- Object storage: controlled drawing files.
- Application configuration: deployment environment variables and infrastructure configuration stored in the deployment provider/secret manager.

## Minimum production policy
- Enable managed daily database backups and point-in-time recovery when the selected Supabase plan supports it.
- Replicate/export critical drawing objects to a separate backup location according to customer retention contracts.
- Retain audit logs longer than ordinary application telemetry.
- Do not back up plaintext secrets into application repositories or database rows.

## Restore drill
At least quarterly, restore the production backup into an isolated recovery project, verify tenant/RLS behavior, compare RFQ/quote counts, open representative drawing objects, and run a quotation calculation. Record recovery time and data-loss window.
