# Production release checklist

1. Create isolated staging and production Supabase projects.
2. Apply all migrations in order and run `supabase/tests/rls.test.sql` against a disposable environment.
3. Configure private `drawings` storage bucket and confirm no anonymous object access.
4. Configure production domains, HTTPS, Supabase redirect URLs and invitation redirects.
5. Configure production SMTP for authentication/invitations.
6. Put `SUPABASE_SERVICE_ROLE_KEY`, Gemini/OpenAI keys and extractor HMAC secret only in server-side secret stores.
7. Set `PLATFORM_ADMIN_EMAILS` to a very small reviewed allowlist.
8. Deploy the Python extractor separately from the web tier and restrict its ingress to the intended application/worker path.
9. Add malware scanning before making arbitrary customer uploads generally available.
10. Configure error monitoring, structured logs, uptime checks and alerting for queue failures.
11. Configure database/storage backups and perform a documented restore test.
12. Configure Razorpay/Stripe only after plan/pricing/legal terms are finalized; validate signed webhooks and idempotency.
13. Run dependency audit, SAST, secret scanning, API authorization tests and an external penetration test.
14. Verify quote PDF commercial/legal wording with finance/legal before customer use.
15. Run representative acceptance drawings for sheet metal, machining, fabrication and assemblies; compare extracted and quoted results with senior estimators.
16. Validate actual-vs-quoted feedback on completed production jobs before enabling automated historical recommendations broadly.
