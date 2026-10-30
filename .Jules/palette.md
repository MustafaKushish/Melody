## 2025-05-18 - Accessible Dialog Titles for Dynamic Sheets
**Learning:** Dynamic bottom sheets with `role="dialog"` require an explicit `aria-labelledby` referencing their heading element so screen readers announce the modal's purpose when focused.
**Action:** Automatically link the first heading element (`h1-h4` or `.sheet-head .t`) inside `openSheet()` to the `aria-labelledby` attribute of the sheet container.

## 2026-10-17 - Dynamic ARIA Pressed and Descriptive Labels for Toggle Icon Buttons
**Learning:** Icon-only toggle buttons (like favorite, shuffle, and repeat) require dynamic `aria-label` updates (e.g., "Zu Lieblingssongs hinzufügen" vs "Aus Lieblingssongs entfernen") alongside `aria-pressed="true|false"` so screen readers clearly communicate both the current state and the action triggered upon activation.
**Action:** Always update both `aria-pressed` and dynamic `aria-label` whenever toggle button state is synchronized in player UI functions.

## 2026-10-20 - Contextual ARIA Labels for Repeated List Action Buttons
**Learning:** Icon-only action buttons rendered in repetitive list rows (such as episode play/download/mark buttons) need to include the item title in `aria-label` (and reflect state, e.g. "Pausieren: [Title]" vs "Abspielen: [Title]") so screen reader users hear clear context rather than ambiguous repeated actions.
**Action:** Append the item title (`esc(item.title)`) to action verb descriptions when generating HTML string templates for list item action buttons.

## 2026-10-24 - Static ARIA Labels with Dynamic ARIA Value Text for Range Inputs
**Learning:** Range inputs (`<input type="range">`) should keep a static `aria-label` (e.g. "Lautstärke") and use `aria-valuenow` / `aria-valuetext` for value updates to prevent redundant announcements in screen readers.
**Action:** Avoid interpolating current values into `aria-label` on range controls when `aria-valuetext` is already configured.

## 2026-10-25 - Converting Interactive Player Containers to Semantic Buttons with Track Context
**Learning:** Interactive containers in player bars that open modal views (e.g., Now Playing) must be semantic `<button>` elements with CSS resets. Dynamically updating their `aria-label` and `title` with current track metadata gives screen reader and keyboard users clear context about what action opening the full-screen view performs.
**Action:** Use standard `<button>` elements for player bar track containers and update `aria-label` and `title` dynamically when updating player UI state.

## 2026-10-28 - ARIA Pressed States on Option Group Swatches and Explicit Input Labels
**Learning:** Selection chips and swatch buttons in option groups (such as theme and accent color selectors) need explicit `aria-pressed="true|false"` attributes so screen reader users perceive the active state. Search inputs relying solely on placeholders need explicit `aria-label`s for screen reader announcements.
**Action:** Always add `aria-pressed` to active option group toggle buttons and ensure search inputs carry explicit `aria-label` attributes.
