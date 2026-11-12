# Staging acceptance flow

1. Register a new company with a fresh work email.
2. Confirm email if Supabase email confirmation is enabled.
3. Sign in and verify only the new tenant is visible.
4. Add a customer.
5. Create an RFQ.
6. Add material/process master rates.
7. Upload a text-layer PDF drawing.
8. Confirm analysis job moves queued → processing → completed.
9. Verify extracted drawing number, revision, material, dimensions and weight evidence.
10. Accept extraction as a reviewed part.
11. Confirm drawing weight wins when explicitly stated.
12. Confirm geometry weight is used when drawing weight is absent and sufficient geometry/material exist.
13. Add process-route operations and verify time-based route cost.
14. Add direct material/process cost lines.
15. Set overhead and margin and verify deterministic recalculation.
16. Download quotation PDF.
17. Create a second company/user and attempt to access the first tenant's RFQ, drawing path, customer and rate IDs. Every attempt must be denied.
18. Test viewer role cannot create or modify commercial data.
19. Test estimator cannot modify master rates.
20. Upload unsupported/oversized files and confirm rejection.
21. Burst API requests and confirm 429 rate limiting.
22. Review audit log entries for commercial changes.
