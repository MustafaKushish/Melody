## 2025-05-18 - Accessible Dialog Titles for Dynamic Sheets
**Learning:** Dynamic bottom sheets with `role="dialog"` require an explicit `aria-labelledby` referencing their heading element so screen readers announce the modal's purpose when focused.
**Action:** Automatically link the first heading element (`h1-h4` or `.sheet-head .t`) inside `openSheet()` to the `aria-labelledby` attribute of the sheet container.

## 2026-10-17 - Dynamic ARIA Pressed and Descriptive Labels for Toggle Icon Buttons
**Learning:** Icon-only toggle buttons (like favorite, shuffle, and repeat) require dynamic `aria-label` updates (e.g., "Zu Lieblingssongs hinzufügen" vs "Aus Lieblingssongs entfernen") alongside `aria-pressed="true|false"` so screen readers clearly communicate both the current state and the action triggered upon activation.
**Action:** Always update both `aria-pressed` and dynamic `aria-label` whenever toggle button state is synchronized in player UI functions.
