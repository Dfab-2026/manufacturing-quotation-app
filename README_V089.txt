Manufacturing Quotation App v0.8.9

Main mixed-file behavior:

Example:
- Upload STEP
- Upload PDF later
- Both stay in the same session
- PDF is analyzed
- STEP is not sent through the 2D drawing analyzer
- STEP remains separately stored and linked to DFM

Source Overview:
- Every uploaded file gets its own button after analysis
- Shows 1/2, 2/2, 1/10, etc.
- Analyzed drawing buttons show extracted drawing number
- STEP/STP/CAD buttons show CAD Linked
- Clicking an analyzed drawing opens its exact review/cost sheet
- Clicking CAD shows a CAD source overview without replacing drawing analysis

Upload speed:
- Browser accepts the file immediately
- UI shows ✓ Uploaded immediately
- Database source-file storage runs in the background
- Analyze Drawing does not wait for database upload completion

Persistence:
- sourceFiles is stored in IndexedDB workspace data
- existing backend database source-file persistence remains
- Back navigation continues restoring session/workflow state

No unrelated DFM/BOM/costing/cursor/logo changes.
