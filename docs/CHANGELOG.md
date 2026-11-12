# v0.7.0 — reconstructed direct analysis

- Rebuilt the normal upload/analyze path to call the secured extractor directly.
- Worker is now retry/fallback only.
- Unified direct and worker extraction pipelines.
- Added HMAC file-digest service authentication.
- Added CAD/text AI path and graceful optional OCR fallback.
- Preserved printed dimension order.
- Carried AI process suggestions into editable quotation manufacturing routes.
- Expanded protected-route middleware coverage.

# Changelog

## v0.3.0 — enterprise quotation suite
- Preserved existing auth, RFQ, drawing extraction/review, routing, costing and PDF flows.
- Added enterprise manufacturing masters, suppliers, assemblies/BOM and quantity-break pricing.
- Added quote approval workflow and immutable quotation revisions.
- Added expanded team roles, invitations and subscription-aware user/drawing limits.
- Added actual production cost feedback, reporting and historical similar-part search.
- Added customer/company commercial configuration, subscriptions/usage, integrations registry and platform admin view.
- Added audit triggers, health endpoint and production/backup documentation.
- Updated quotation PDF to include issuing-company name, validity, payment terms and configured commercial terms.

## v0.4 — Streamlined drawing-to-quotation workflow
- Reduced primary sidebar to the operational essentials while preserving existing enterprise pages/routes.
- Added a dedicated Upload & Analyze flow: quotation setup → multi-file drawing upload → analysis review → editable quotation.
- Added common engineering upload formats: PDF, JPG/PNG/TIFF/WebP, DXF, DWG, STEP/STP, IGES/IGS and ZIP packages.
- Added automatic analysis waiting/refresh state and dedicated review route.
- Expanded extracted engineering review fields for tolerances, surface finish, weld details, hole/thread details, heat treatment and coating.
- Added CAD-safe preview behavior: browser preview for PDF/images and controlled original-file access for CAD formats.
- Added fully editable quotation header, item fields, manual cost lines, tax/freight/validity, overhead/margin and PDF download.
- Updated quotation PDF total to include configured freight and tax.
- Preserved existing RLS, tenant isolation, approvals, revisions, master data, reporting and enterprise modules.

## v0.5 - AI manufacturing process planning
- Added AI-generated manufacturing route recommendations to drawing analysis.
- Added editable Process Plan step between drawing review and quotation.
- Added process confidence, work-center suggestion, engineering reason, setup/cycle fields and estimator overrides.
- AI does not invent time, rates or price; commercial calculations remain deterministic/manual-master driven.
- Approved AI routes save to existing `process_routes` as `inferred` without replacing manual routes.
- No database migration required.

## v0.6 - Streamlined three-page estimator flow
- `/upload` is now the primary drawing-first start page with one clear **Analyze Drawing** action.
- RFQ creation happens securely in the background from the uploaded drawing package.
- Main estimator flow is now exactly: **Upload & analyze → Analyzed data → Quotation**.
- Analysis review remains fully editable with source/evidence/confidence and weight validation.
- After approving the last drawing, the user goes directly to the quotation page. Multi-drawing packages continue review until all drawings are approved.
- The existing AI process-planning module remains in the codebase but is no longer inserted in the main three-page flow.
- No database migration required.
