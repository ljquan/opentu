## Context

The approved visual reference covers the home page, account entry, creative
center, works, workflows, model marketplace, music station, and canvas.

## Goals / Non-Goals

- Goals: one recognizable visual system, professional dark surfaces, stable
  layout, accessible contrast, and a C1-inspired canvas hierarchy.
- Non-goals: replace Drawnix, change generation behavior, or add cloud sync.

## Decisions

- Keep component markup and business behavior unless layout semantics require a
  small adjustment.
- Use scoped CSS custom properties so third-party canvas controls are not
  globally recolored without context.
- Use coral for primary commands, violet for selection, and teal for healthy or
  completed states.
- Keep radii at 8px or below and avoid nested decorative cards.

## Risks / Trade-offs

- Deep third-party editor surfaces may retain their own theme colors. Scope the
  shell treatment and verify the actual canvas at desktop and mobile widths.
- Large imagery can affect loading. Reuse existing optimized product assets and
  avoid adding new runtime images in this implementation.

## Migration Plan

Apply styles incrementally, validate every route, and preserve the existing CSS
files so rollback does not affect product data or API behavior.
