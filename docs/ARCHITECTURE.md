# Architecture

## Product boundary

ForgeQuote is a multi-tenant manufacturing RFQ and quotation platform. Each customer company is a tenant. Tenant data is isolated in PostgreSQL Row Level Security, not by URL conventions or frontend filtering.

## Runtime components

### Web/BFF — Next.js 16

Responsibilities:

- authentication/session handling
- role-based UI
- customer/RFQ/rate management
- controlled drawing uploads
- quotation workflows
- server-side validation
- protected APIs

The browser receives only the Supabase publishable key. Service-role credentials stay server-side.

### Core package — TypeScript

Pure deterministic functions for:

- material density lookup
- geometry/mass calculation
- raw material + scrap calculation
- rate-line calculation
- overhead/margin calculation

This code has no database or AI dependency, which makes it easy to unit test and audit.

### Drawing extractor — FastAPI worker

Responsibilities:

- PDF text-layer extraction
- OCR fallback for scanned PDFs/images
- drawing number/revision/material/weight/dimension parsing
- structured extraction output with source, confidence and evidence
- asynchronous job processing

The worker uses a service-role credential and must run in a private server environment. It claims queue jobs atomically with `FOR UPDATE SKIP LOCKED`.

### Data plane — Supabase/PostgreSQL

Primary source of truth for:

- tenants/memberships
- customers
- RFQs
- drawings/extractions
- parts
- process routes
- master rates
- cost lines
- quote versions
- audit records

Private Supabase Storage holds drawings. Paths begin with tenant UUID and storage policies re-check tenant membership.

## Weight priority

1. drawing-stated weight
2. exact CAD volume × density
3. deterministic geometry calculation
4. profile/BOM calculation
5. inferred value only when explicitly flagged

Never silently overwrite a drawing-stated value with an inferred value.

## Commercial pricing rule

AI may suggest process routing and quantities. Money is always calculated by deterministic formulas from controlled company rates.

`direct = Σ(quantity × rate × waste)`

`manufacturing = direct + overhead`

`selling = manufacturing / (1 - margin%)`

## Scale path

The current boundary allows independent scaling:

- web: Vercel/Node server instances
- extraction API: containers
- workers: N replicas
- database/storage: Supabase/PostgreSQL

Later STEP/DXF/CAD services can be added behind the extraction boundary without changing the RFQ UI or costing engine.
