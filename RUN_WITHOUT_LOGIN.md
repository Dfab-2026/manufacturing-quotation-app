# Manufacturing Quotation App — Direct Access (No Login)

This package is based on the user's uploaded `manufacturing-quotation-app-main(2).zip`, retaining the targeted quotation/rate-master fixes from the immediately preceding update.

## Authentication status
- There is no `/login`, `/signup`, or authentication page in the uploaded frontend.
- `frontend/app/page.tsx` mounts the actual application directly on `/` and initializes the Dashboard view.
- The frontend contains no Next middleware or proxy that redirects to a login page.
- The existing drawing analysis, rate master, editable quotation, saved workspace, and other app features were not rewritten for this packaging.

## Run locally
1. In `backend`, create and activate a Python virtual environment, install `requirements.txt`, and start `uvicorn app.main:app --reload --port 8000`.
2. In `frontend`, copy `.env.local.example` to `.env.local`, install packages using `npm ci`, then run `npm run dev`.
3. Open `http://localhost:3000` — it should open the app directly, without a login page.

If a login page still appears, make sure you are running THIS frontend, not an older `manufacturing-quotation-platform-v0.x` app, a cached deployment, or a reverse-proxy login gate. Check which project is serving port 3000 and restart it.

## Security notice
This codebase has no user authentication layer. Run it only on a trusted local/private network until authentication and authorization are added for public or multi-company deployment. Do not expose writable APIs on the public internet unprotected.

## Change scope
No application implementation files were changed for this request because the uploaded source already opens directly without login. This note documents the verified behavior, and all previous functionality remains intact.
