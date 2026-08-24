Manufacturing Quotation App v0.6.3 — Gemini stability + speed fix

Why the 502 happened
====================
The app was wrapping every Gemini exception as HTTP 502.
With batch concurrency=2 and frontend retries=3, one batch could burst several
Gemini requests quickly. On free-tier API limits this can cause 429 /
RESOURCE_EXHAUSTED or transient service failures.

Changes
=======
- Exact previous UI preserved.
- Vercel RevisionRecord TypeScript fix retained.
- Batch analysis concurrency: 2 -> 1.
- Frontend retries: 3 -> 2.
- Frontend retry delay: 3.5 seconds.
- Gemini backend performs one controlled retry only for transient errors.
- Gemini 429 errors now return HTTP 429 instead of misleading 502.
- Gemini temporary availability errors return HTTP 503.
- Backend prints the exact Gemini exception as [ANALYZE ERROR].
- Direct-PDF fast extraction remains enabled.
- Neon PostgreSQL remains enabled.

After replacing files
=====================
Backend:
python -m uvicorn app.main:app --reload --port 8000

Then analyze ONE drawing first.

If Gemini fails, the terminal will now show:
[ANALYZE ERROR] <real upstream error>

For Git/Vercel:
git add .
git commit -m "Fix Gemini analyze stability"
git push
