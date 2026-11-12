import { QuickDrawingAnalyze } from "@/components/quick-drawing-analyze";
import { requireRole } from "@/lib/security/auth";

export default async function UploadStartPage() {
  await requireRole(["owner", "admin", "estimator"]);

  return (
    <>
      <div className="page-head upload-page-head">
        <div>
          <span className="eyebrow">Step 1 of 3</span>
          <h1>New quotation</h1>
        </div>
      </div>

      <div className="flow-progress" aria-label="Quotation progress">
        <div className="flow-progress-item active"><span>1</span><strong>Upload & analyze</strong></div>
        <div className="flow-progress-line" />
        <div className="flow-progress-item"><span>2</span><strong>Analyzed data</strong></div>
        <div className="flow-progress-line" />
        <div className="flow-progress-item"><span>3</span><strong>Quotation</strong></div>
      </div>

      <section className="card upload-focus-card">
        <QuickDrawingAnalyze />
      </section>
    </>
  );
}
