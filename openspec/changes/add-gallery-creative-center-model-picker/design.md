## Context

The existing home surface already owns the curated model catalog, while the
workspace runtime owns boards and tasks. The new UI must connect those existing
boundaries without moving provider credentials into the browser or introducing
a second model source.

## Decisions

- Keep the home marketplace section as the source component and render its
  focused overlay from the same catalog state.
- Pass model identity through `model` and `mode` query parameters so refresh,
  deep links, and browser history retain the user's choice.
- Keep the creative center presentation-only for model metadata; actual board
  creation continues through the existing workspace callback.
- Use a single content sidebar on the creative center and place task status in
  the content flow, reducing the old multi-column editor feel.

## Risks / Trade-offs

- The current URL router is intentionally lightweight, so query parsing remains
  in `app.tsx`; this keeps navigation compatible but leaves future route
  extraction as a separate refactor.
- Curated model metadata can be incomplete for administrator-published IDs;
  unknown consumer IDs use the catalog's existing safe inference path.
