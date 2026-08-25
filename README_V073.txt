Manufacturing Quotation App v0.7.3 — Starter Rates Restore Fix

Problem fixed:
Some existing Neon/PostgreSQL databases could retain an older/partial Rate Master,
so the new starter rates were not all visible after upgrading.

New behavior:
- Every GET /api/rates checks that all built-in starter rows exist.
- Missing starter rows are automatically inserted.
- Built-in starter rows with price 0 are filled with the starter price.
- Positive rates already edited by the engineer are NOT overwritten.
- Custom/user-added Rate Master rows are NOT deleted or overwritten.
- Rate Master now has a "Restore Starter Defaults" button.

Expected built-in starter set:
- 18 material rates
- 25 process rates
- 8 labour rates
- 2 other rates
- 3 commercial rates
= 56 built-in starter rows

The database can contain more than 56 rows because custom rates are preserved.

After replacing files:
Backend:
  python -m uvicorn app.main:app --reload --port 8000

Frontend:
  cd frontend
  npm run dev

Then open Rate Master and click:
  Restore Starter Defaults

This will immediately repopulate missing starter rates without wiping your custom rates.
