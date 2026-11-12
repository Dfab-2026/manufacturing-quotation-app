# Deployment

## Recommended production layout

- Web: Vercel or containerized Node deployment.
- Database/Auth/Storage: Supabase production project.
- Extractor API + workers: Render, Fly.io, AWS ECS/Fargate, Azure Container Apps, GCP Cloud Run + worker platform, or Kubernetes.
- DNS/TLS: managed provider with HSTS enabled after domain validation.

## Environment separation

Use separate Supabase projects and secrets for development, staging and production. Never point local development to production data. Exact variable names and placement are documented in `ENVIRONMENT.md`.

## Database

Apply migrations in order from `supabase/migrations`. Run RLS tests before deployment. Production schema changes must use migrations; do not edit tables manually in the dashboard.

## Worker

The queue worker requires:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- OCR system package (included in Dockerfile)

Run at least two workers for high availability after verifying workload sizing.

## CI/CD gates

A release should fail when any of these fail:

- lint
- TypeScript typecheck
- deterministic core unit tests
- Python unit tests
- Next.js production build
- database/RLS tests

## Observability

Track at minimum:

- API request latency/error rate
- drawing upload failures
- extraction queue depth and age
- extraction success/failure by file type
- worker processing time
- quote creation/sent/won conversion
- database/storage utilization
- unauthorized/429 rates
