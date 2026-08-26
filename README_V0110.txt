DFAB Manufacturing Quotation App v0.11.0 — Engineering Intelligence Upgrade

IMPLEMENTED
===========
1. Two-axis classification for every source
   - Document Type:
     Part Drawing / Assembly Drawing / General Arrangement /
     Weldment-Fabrication Drawing / Detail Drawing
   - Manufacturing Type:
     CNC Milling / CNC Turning / General Machining / Laser Cutting /
     Sheet-Metal Fabrication / Welding-Fabrication / Drilling-Boring /
     Threading-Tapping / Grinding-Finishing / Casting / Forging /
     Extrusion / Tube-Pipe Fabrication / Additive Manufacturing /
     Purchased-Standard Part / Assembly-Integration / Inspection
   - Part Form:
     plate, sheet, block/prismatic, shaft/cylindrical, flange, bracket,
     frame, tube/pipe, enclosure/cover, gear, casting, assembly, standard part.

2. Classification confidence and evidence
   - Gemini schema requests classification evidence.
   - Deterministic engineering intelligence validates/normalizes it.
   - Evidence/provenance table is visible in Engineering Details.
   - Release state: READY / REVIEW / ATTENTION.

3. Document-understanding layer
   - PyMuPDF now extracts ordered page text blocks with page + bbox context.
   - The original PDF, searchable text, layout blocks and title crop are used together.
   - No extra paid OCR service is required for this local layer.

4. CAD intelligence
   - Existing OpenCascade Web Worker retained.
   - CAD bounding geometry now generates a shape hint:
       plate_like / rotational_like / prismatic_like / unknown
   - STEP/STP/IGES/STL/OBJ can use the shape hint to classify likely
     Laser/Sheet route, CNC Turning or CNC Milling/General Machining.
   - Assembly part count/tree still remains independent per source.

5. Assembly decomposition
   - assembly_parts become independent manufactured-component BOM rows.
   - Unknown component values stay blank; data is never copied from another source.

6. Manufacturing route
   - Ordered process route generated and shown as route chips.
   - Multiple processes are supported; document type is never confused with process type.

7. Completeness / quotation readiness
   - Engineering Data score
   - Cost Confidence score
   - Classification Confidence
   - Rate Coverage
   - Review-required list
   - READY / REVIEW / ATTENTION state

8. Cost traceability
   - Backend returns structured cost_trace.
   - Cost Sheet shows live Qty × Rate = Amount explanations using current editable rows.
   - Rate source and confidence stay visible.

9. Revision comparison
   - "Compare Previous" added in Drawing Review.
   - Compares revision, description, material, thickness, weight, quantity,
     classification fields and selling-price delta against the latest saved revision.

10. Learning from engineer corrections
   - Review save now stores the edited ai_raw engineering intelligence with the exact file hash.
   - Re-analysis first checks exact reviewed memory when the same file hash is uploaded.
   - This is review-memory reuse only; it does NOT auto-add the source to the curated Training Dataset.

11. DFM/BOM integration
   - DFM carries document type, part form and classification confidence.
   - DFM primary classification uses engineering intelligence.
   - BOM separates assembly components.
   - Source tabs can show the engineering class for the selected source.

EXTERNAL COMMERCIAL/PAID ENGINES
================================
The application remains deployable without new credentials or licenses.
Google Document AI, a second-model OpenAI validator, and HOOPS Exchange are NOT silently enabled in this patch because they require external credentials and/or commercial licensing. The current implementation uses:
- PyMuPDF layout extraction + Gemini for PDF/image understanding
- OpenCascade/occt-import-js for STEP/STP/IGES
- deterministic STL/OBJ geometry parsing
- deterministic engineering intelligence as a validation layer

Those commercial providers can later be added as optional adapters without changing the data model introduced in v0.11.0.

DEPENDENCIES
============
No new dependency required beyond existing backend/requirements.txt and the full frontend project's existing packages.
