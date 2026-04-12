---
name: invoice-gen
description: Generate a professional invoice from project/hours data. Auto-invoked when user says "generate invoice", "create invoice", "bill this client".
model: haiku
context: fork
allowed-tools: Read, Write
---

Generate a professional invoice right now from the following info:

**Input:** $ARGUMENTS (client name, project, line items with hours/rates or fixed amounts)

Output this invoice in markdown:

```
# INVOICE

**Invoice #:** INV-[YYYYMMDD]-001
**Date:** [today]
**Due:** [today + 15 days]

---

**From:** [Your Name]
**To:** [client name and details from input]

---

| Description | Hours | Rate | Amount |
|-------------|-------|------|--------|
| [line item] | [hrs] | [rate] | [total] |
| ... | ... | ... | ... |

---

**Subtotal:** $X
**Tax:** $0 (unless specified)
**TOTAL:** $X

---

**Payment:** Bank transfer or Wise
**Terms:** Net 15
```

If any required info is missing (client name, line items), ask for it. Auto-generate the invoice number from today's date.
