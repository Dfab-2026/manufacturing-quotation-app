# Continuous Dataset Learning

## What happens automatically

1. User uploads a drawing.
2. Backend calculates SHA-256 file hash.
3. Extraction result is stored in `backend/data/extractions.json` when Auto Dataset Capture is enabled.
4. Engineer corrects fields and clicks `Save Review & Continue`.
5. Corrected drawing + cost rows are stored in `backend/data/reviews.json` as supervised training data.
6. If the exact same drawing file is uploaded again, the latest reviewed correction is reused automatically.
7. Dataset Learning page shows extraction/review counts and whether the configured training-batch threshold is reached.
8. Reviewed dataset can be exported as JSONL.

## Why model weights are not changed after every single drawing

Per-sample online retraining can cause catastrophic forgetting, data poisoning, unstable behavior and difficult rollback. A production AI system should capture every correction immediately, but retrain/fine-tune in validated batches with evaluation and versioning.

When the real OCR/Vision model is connected, add a training worker that runs only after the threshold is reached and after validation/approval.
