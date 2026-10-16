## 2025-05-18 - Accessible Dialog Titles for Dynamic Sheets
**Learning:** Dynamic bottom sheets with `role="dialog"` require an explicit `aria-labelledby` referencing their heading element so screen readers announce the modal's purpose when focused.
**Action:** Automatically link the first heading element (`h1-h4` or `.sheet-head .t`) inside `openSheet()` to the `aria-labelledby` attribute of the sheet container.
