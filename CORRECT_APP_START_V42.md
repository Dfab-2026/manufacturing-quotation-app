# Correct app start

The repository previously contained an old monorepo root script that launched the obsolete ForgeQuote UI.

V42 changes only the root npm scripts so the root command launches `frontend/`, which is the DFAB AI Quotation UI.

Use either:

```powershell
npm install --prefix frontend
npm run dev
```

or:

```powershell
.\START_CORRECT_DFAB_APP.ps1
```

Open `http://localhost:3000/`. The `/upload` route redirects to `/`.

The old source folders remain untouched; they are simply no longer used by root npm scripts.
