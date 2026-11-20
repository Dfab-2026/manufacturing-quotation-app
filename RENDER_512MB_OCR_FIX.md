# Superseded Render OCR instructions

The earlier 512 MB workaround disabled OCR, which means scanned drawings and small callouts can be missed. **Do not set LOCAL_OCR_ENABLED=false** when deploying the current drawing reader. Follow `backend/RENDER_DEPLOY.md` for the current build command and diagnostic endpoint.

If Render logs show out-of-memory termination, the service needs sufficient RAM for its OCR/CAD workload. No instance-size guarantee is made. Preserve existing database configuration.
