# Weight priority fix

Weight source order:
1. Printed WEIGHT/MASS from drawing (authoritative).
2. Approved Training Dataset prediction scaled by matching material/form/thickness and geometry.
3. Deterministic geometry/material-density prediction.

The 1 kg material allowance remains separate and is added only after base product weight is established.
Predicted weights are tagged so they cannot later be mistaken for printed drawing weights.
