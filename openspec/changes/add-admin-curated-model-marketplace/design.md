## Context

OpenTu already has runtime model discovery and a Tuzi Session API client. The
Session API exposes `/api/user/models`, which represents the models available
to the current user after administrator group configuration. The home page is
a public consumer surface and must not own provider credentials.

## Goals / Non-Goals

- Goals: reflect administrator-published models, provide useful categories and
  search, keep the marketplace fast, and preserve a polished local fallback.
- Non-goals: implement a second provider discovery system, expose API keys,
  duplicate pricing data, or add a new backend inside this frontend repository.

## Decisions

- Decision: use `/api/user/models` as the published-model boundary in embedded
  deployments. It is Session authenticated and returns IDs without provider
  secrets.
- Decision: adapt IDs into marketplace presentation metadata in the web app.
  Known models receive curated names and descriptions; unknown administrator-
  published models receive conservative inferred metadata.
- Decision: filter operation and infrastructure endpoints from the public
  catalog. The generation stack can continue using those capabilities behind
  user-facing model entries.
- Decision: use a curated fallback when the Session API is unavailable. This
  keeps the standalone build useful without pretending that a provider key is
  safe to embed in the frontend.

## Risks / Trade-offs

- Unknown models have less descriptive metadata until an administrator-facing
  catalog metadata endpoint exists. The adapter keeps this replaceable.
- `/api/user/models` may return a large list. Search, category filtering, and
  progressive disclosure prevent the home page from rendering it all at once.
- Upstream pricing is intentionally not copied because it changes independently
  and is not part of the current public API contract.

## Migration Plan

1. Add the marketplace catalog adapter and curated metadata.
2. Add the marketplace component and replace the old home model cards.
3. Add focused tests and responsive browser verification.
4. Later replace the adapter response with richer server metadata without
   changing the component contract.

