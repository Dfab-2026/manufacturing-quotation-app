# V63 - Ongoing -> New Quotation unlock

Targeted change only.

- A quotation resumed from Ongoing/History can always start a New Quotation.
- If the resumed draft has no live batch payload/File objects, its existing draft snapshot is refreshed best-effort and the workflow immediately resets to Step 1 Upload.
- IndexedDB preview-cache failure no longer blocks New Quotation; the local History Draft remains preserved.
- All other flows remain unchanged.
