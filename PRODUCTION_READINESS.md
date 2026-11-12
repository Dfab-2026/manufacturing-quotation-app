# Production readiness notes

## Implemented

- Clear three-stage quotation workflow
- Editable engineering review
- Editable rates and cost rows
- Live commercial percentage recalculation
- Draft persistence and resume
- DFM/BOM report generation
- DFM/BOM generated concurrently during analysis
- PDF/Excel export
- Quotation history
- App-style notifications (no browser alert/confirm requirement in the rebuilt workflow)
- Explicit Gemini quota/network errors
- No fabricated successful analysis after AI failure
- PostgreSQL production persistence
- SQLite local fallback
- File extension and 30 MB upload validation

## Production deployment requirements

- PostgreSQL database with backups
- Private Gemini API key and sufficient quota
- HTTPS frontend/backend
- Restrict `FRONTEND_ORIGIN` to the deployed frontend
- Secrets stored in deployment environment variables
- Run frontend production build and backend tests in CI
- Add organization authentication/SSO before exposing confidential customer drawings to multiple external companies
- Add malware scanning if uploads are accepted from untrusted external customers
