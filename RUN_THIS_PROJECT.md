# Run the exact uploaded project (original UI preserved)

This folder comes from `manufacturing-quotation-app-main(4).zip`. It is **not** the `@mq/web` monorepo.
Do not run `npm run dev:web` or `npm run dev:extractor`.

## One-time setup (PowerShell)

1. Copy `backend/.env.example` to `backend/.env` and enter your private `DATABASE_URL` and `GEMINI_API_KEY`. The source uses SQLAlchemy PostgreSQL; Supabase *database connection string* can be used, but Supabase URL/publishable/service-role keys do not replace DATABASE_URL.
2. Copy `frontend/.env.local.example` to `frontend/.env.local`. Keep `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000` for local use.

### Terminal A — Backend
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Terminal B — Frontend
```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`; test backend health at `http://127.0.0.1:8000/api/health`.

## Scope of this targeted update
- Original pages, CSS theme, navigation, database models and quotation exporting are retained.
- Upload card now reports `Saving…` until the server confirms persistence and `Uploaded` afterward; original uploaded files still remain available for analysis.
- The quotation's Wastage, Overhead and Markup percentages are now directly editable. Amounts and final selling price are still editable. Percentage edits recalculate through the existing server cost engine, and are saved with the existing draft flow.
- Rate Master price auto-saves on field blur, its switch auto-saves on toggle, and cost-row overrides continue to sync to Rate Master. Attention has a Go-to-rate action and disappears as soon as the rate is positive.
- Existing direct FastAPI drawing analysis, hash cache and retry behaviour remain unchanged. A one-second analysis promise cannot be made for complex drawings or slow Gemini responses.

## Security note
Do not commit `.env` or `.env.local` and do not share API/database credentials. This originally uploaded repository does not implement tenant-isolated Supabase Auth/RLS, so do not market it as a hardened multi-tenant SaaS without a separate security audit and implementation.
