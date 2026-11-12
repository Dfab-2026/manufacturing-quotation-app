# Enterprise modules added in v0.3

This release is additive. Existing authentication, RFQ, drawing extraction/review, routing, master-rate costing and quotation PDF flows are preserved.

## Added
- Material master: density, purchase rate, scrap allowance, grade and standard-size metadata.
- Machine master: machine type, hourly rate, setup charge and capacity metadata.
- Process master: basis, rate, minimum charge, setup time and compatible-material metadata.
- Supplier/subcontractor master and supplier-rate schema.
- Assemblies/BOM: group reviewed parts under manufactured assemblies.
- Quantity-break pricing: deterministic setup-cost dilution across batch quantities.
- Quote revisions: immutable commercial snapshots in `quote_versions`.
- Approval workflow: request, approve/reject and decision history.
- Expanded roles: sales, approver, production and finance in addition to owner/admin/estimator/viewer.
- Team invitations via Supabase Auth and plan-aware user limits.
- Actual production cost capture and quote-vs-actual reporting.
- Historical similar-part search using tenant-scoped material/text/dimension similarity.
- Company quotation defaults: legal name, tax ID, currency, tax, scrap and commercial terms.
- Customer commercial defaults: contact, currency, payment terms, default margin and addresses.
- Subscription plans, tenant subscriptions and drawing/user quota enforcement.
- Cross-tenant platform-admin operational view protected by `PLATFORM_ADMIN_EMAILS` and server-side service role.
- ERP/integration connection registry for Odoo, SAP, Tally, Zoho, Dynamics and webhooks. Credentials are intentionally excluded from the database and belong in a secret manager.
- Immutable audit triggers on key commercial/manufacturing tables.
- Minimal `/api/health` endpoint for uptime probes.

## Deliberately configuration-dependent before public launch
The following require external accounts/infrastructure rather than code-only defaults:
- Razorpay/Stripe live checkout and webhooks.
- Production SMTP for Supabase invitations/auth email.
- SSO/SAML provider configuration.
- Antivirus/malware scanning service for uploaded drawings.
- Central logging/Sentry/APM destination.
- Managed backup retention and restore drills.
- ERP credentials and per-customer field mappings.

Do not store those secrets in database rows or browser environment variables.
