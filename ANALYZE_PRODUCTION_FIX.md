# Analyze Production Fix

Production frontend must use:

NEXT_PUBLIC_API_BASE_URL=https://ai-quotation-api.onrender.com
NEXT_PUBLIC_FASTAPI_URL=https://ai-quotation-api.onrender.com
FASTAPI_INTERNAL_URL=https://ai-quotation-api.onrender.com

Render backend must allow:

FRONTEND_ORIGIN=https://dfab-quotation.vercel.app

Single-file flow is now intentionally:

Analyze click -> Step 2 immediately -> direct POST https://ai-quotation-api.onrender.com/api/analyze -> populate Drawing Review.

No workspace save, DB sync, DFM/BOM generation, or Vercel proxy is allowed to block this transition.
