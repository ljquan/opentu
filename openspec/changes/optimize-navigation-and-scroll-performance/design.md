## Context
The application renders ordinary pages and the canvas workspace from one React entry point. Global overflow rules were written for the canvas but also applied to ordinary pages.

## Decisions
- Use the document as the scroll container for ordinary pages. Keep `.next-workspace` isolated with its existing `height: 100%` and `overflow: hidden` behavior.
- Use `history.pushState` for home, creative center, and music station. Keep board entry as a full navigation because it still requires the workspace bootstrap and board restoration path.
- Use `window.scrollTo` with a reduced-motion check for section navigation, and `IntersectionObserver` for active section state.
- Start the music station lazy import during idle time after the first page is usable.

## Risks / Trade-offs
- Browser history now contains ordinary-page route entries, so route callbacks must update React state and `popstate` must restore it.
- Idle prefetch consumes some bandwidth; it is limited to the already-supported lazy music station chunk and runs after the first frame.
