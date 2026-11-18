# Ongoing Diamond Resume V56

Targeted update only; all unrelated quotation, STEP/PDF analysis, costing, history and workflow code remains unchanged.

## Behaviour
- Restores the compact animated diamond beside New Quotation.
- When New Quotation is pressed while work exists:
  - captures the exact current workflow state before reset;
  - stores it under a dedicated suspended-ongoing IndexedDB key so the new blank quotation cannot overwrite it;
  - retains the workspace dataset;
  - saves the quotation to Quotation History as `Draft / Incomplete`;
  - opens a clean new quotation.
- Clicking the diamond restores the suspended quotation at the exact saved step and restores files, analysis, drawing, cost rows, summary, customer, source files, batch state, DFM/BOM state and editable commercial overrides.
- After restoration, the state is moved back into normal active auto-save and the suspended slot is cleared.
- End Process behaviour remains separate and unchanged.
