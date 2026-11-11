## 1. Implementation
- [x] 1.1 Add resource links and responsive toolbar integration.
- [x] 1.2 Record the announcement on its first display and keep it open until explicitly closed.
- [x] 1.3 Verify persistence, reopening, links, and mobile layout.
- [x] 1.4 Display the missing API Key popup with the original community and support QR images.
- [x] 1.5 Refine dialog spacing, link hierarchy, and input focus styling; verify desktop and mobile QR decoding.

## 2. Approved interaction revision — 2026-11-11
- [x] 2.1 Move the X link into the existing feedback QR popover and remove the download resource card.
- [x] 2.2 Open the shared confirmation dialog from the download button; navigate to the existing official page only on confirmation.
- [x] 2.3 Remove the automatic announcement and complete Chinese and English labels without adding persisted fields.
- [x] 2.4 Verify 7 component tests, drawnix TypeScript checking, and 7 Chromium viewport checks (390–1440px); inspect desktop screenshots. Changed component files pass ESLint; i18n retains its pre-existing useMemo dependency warning.
- [x] 2.5 Refine the download dialog on user request: scoped warm header, download icon, centered typography, concise bilingual copy, separate destination note, and larger action buttons. Rechecked 7 component tests, TypeScript, component ESLint, and the live desktop preview.
