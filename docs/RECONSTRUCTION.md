# v0.7 Reconstruction

This release keeps the existing database/security/enterprise modules and reconstructs the main estimator runtime around one reliable path:

`Upload -> Direct AI analysis -> Editable review -> Editable quotation -> PDF`

## Runtime changes

- Normal drawing analysis no longer depends on the background worker.
- The web API uploads the private drawing and immediately calls the extractor service.
- Web-to-extractor authentication uses timestamped HMAC over the SHA-256 file digest, filename and MIME type.
- Analysis results are written to `drawing_extractions` with the server-only Supabase admin client only after the authenticated tenant/RFQ upload check succeeds.
- A failed direct analysis is returned to the existing queue so the worker can retry it later.
- The worker now uses the exact same extraction pipeline as direct analysis.
- PDF/image flow avoids Tesseract before Gemini; OCR is fallback only.
- Missing Tesseract no longer crashes fallback analysis.
- DXF/STEP/IGES are locally normalized before AI text analysis.
- DWG is never guessed; it stays review-required until a real CAD converter is connected.
- Overall dimensions preserve printed L x W x T order rather than sorting dimensions.
- AI process suggestions are saved when reviewed data is approved and appear as editable manufacturing-process rows on the quotation page.

## Unchanged

Supabase schema/migrations, tenant isolation, auth, customers, masters, rates, enterprise modules, quote calculation core and PDF endpoint remain in place. No new migration is required for v0.7.
