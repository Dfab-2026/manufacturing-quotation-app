# V35 targeted update

Only the requested areas were changed.

- Restored the compact ongoing-quotation diamond beside **New Quotation**. No separate continuation section.
- Desktop Upload Step is fixed to the viewport with no page/document scrolling.
- The uploaded-source queue may scroll internally only when more files exist than can fit.
- Existing Cost Sheet, quotation, rate, database and navigation flows remain unchanged.
- Existing extraction recovery is preserved and verified:
  1. PyPDF/PyMuPDF/DXF/local engineering parsing first.
  2. Gemini recovery for incomplete mandatory engineering data when configured.
  3. RapidOCR/ONNX recovery only when LOCAL_OCR_ENABLED=true and the runtime is installed.
  4. Mandatory-field validation runs before returning the final extraction.
- Render 512 MB can keep LOCAL_OCR_ENABLED=false and use Gemini recovery without loading ONNX models.
