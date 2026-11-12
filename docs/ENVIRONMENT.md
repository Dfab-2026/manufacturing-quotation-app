# Environment configuration

This project intentionally separates browser-safe values from server-only secrets.
Never expose a service-role key, AI key, or HMAC secret with a `NEXT_PUBLIC_` prefix.

## 1. Supabase values

Open your Supabase project and copy the project URL and API keys from the project API settings.

Use:

- `NEXT_PUBLIC_SUPABASE_URL` — browser-safe project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — browser-safe publishable key.
- `SUPABASE_URL` — same project URL, used by the Python extractor.
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only** privileged key used by trusted backend/worker code.

Never place the service-role key in browser code, screenshots, source control, or a `NEXT_PUBLIC_` variable.

## 2. Gemini API

Create a Gemini API key in Google AI Studio / Gemini API credentials and set:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_real_key
GEMINI_MODEL=gemini-3.8-flash
```

The key belongs only to the extractor service. It is not required in the Next.js browser environment.

## 3. Web-to-extractor shared secret

Generate a strong random secret:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Put exactly the same value in `EXTRACTOR_HMAC_SECRET` for both the web app and extractor. This signs private service-to-service requests.

## 4. Local file locations

### Next.js

Create:

`apps/web/.env.local`

Start from `apps/web/.env.local.example`.

### Extractor / worker

Create:

`services/extractor/.env`

Start from `services/extractor/.env.example`.

If you run the supplied root Docker Compose file, you can instead create a root `.env` from `.env.example`; Docker Compose passes it to the extractor container.

## 5. Production locations

### Vercel (web)

Add these under **Project → Settings → Environment Variables** for Production/Preview as appropriate:

```env
NEXT_PUBLIC_APP_URL=https://your-domain.com
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
EXTRACTOR_URL=https://your-private-extractor.example.com
EXTRACTOR_HMAC_SECRET=...
```

Do **not** put `GEMINI_API_KEY` in Vercel unless the web application itself later calls Gemini. The current architecture calls Gemini only from the extractor.

### Extractor hosting (Render/Fly/AWS/Azure/GCP/Kubernetes)

Set:

```env
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
EXTRACTOR_HMAC_SECRET=...
MAX_DRAWING_BYTES=26214400
WORKER_POLL_SECONDS=2
AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.8-flash
```

## 6. Optional OpenAI provider

The existing provider remains available without changing any other workflow:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6-sol
```

Only one provider is active at a time. `AI_PROVIDER=none` disables external AI and leaves deterministic/local extraction active.

## 7. Variables not required yet

Do not add unused Stripe/Razorpay, SMTP, Sentry, Redis, AWS, or ERP secrets yet. They should be introduced only when those modules are implemented so the configuration stays auditable and the attack surface stays small.
