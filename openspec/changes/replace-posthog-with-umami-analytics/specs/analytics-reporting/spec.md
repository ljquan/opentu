## ADDED Requirements

### Requirement: Web analytics SHALL report through Umami

The Web application SHALL load the configured Umami tracker from `https://umami.tu-zi.com/script.js` with website ID `e6bd249e-bc68-4857-b6a5-02131b4ea286`, and runtime analytics events SHALL be sent through `window.umami.track()`.

#### Scenario: Production tracker loads

- **GIVEN** the Web application runs in a reporting-enabled deployment
- **WHEN** the document finishes loading
- **THEN** the Umami tracker SHALL be available for pageview and custom-event reporting
- **AND** the application SHALL NOT initialize the PostHog tracker

#### Scenario: Analytics provider is unavailable

- **GIVEN** the Umami script is blocked, fails, or has not finished loading
- **WHEN** application code requests an analytics event
- **THEN** the event call SHALL not throw into the user workflow
- **AND** application startup and business operations SHALL continue

### Requirement: Existing business event coverage SHALL survive provider migration

The migration SHALL preserve existing business-facing analytics method names, event names, sanitized prompt summaries, and release context fields unless a field is explicitly incompatible with Umami.

#### Scenario: AI generation event

- **WHEN** an image, video, audio, or chat generation starts, succeeds, fails, or is cancelled
- **THEN** the corresponding existing event name SHALL be sent as an Umami custom event
- **AND** the event SHALL contain the existing non-sensitive task and model fields

#### Scenario: Prompt data is reported safely

- **WHEN** a prompt or requirements value is used for analytics
- **THEN** the event SHALL report only the existing summary fields such as length and line count
- **AND** raw prompt text SHALL NOT be sent

#### Scenario: Release context is attached

- **WHEN** a custom analytics event is sent
- **THEN** the event SHALL include version, deployment environment, host, hostname, and route context
- **AND** the implementation SHALL NOT depend on PostHog `register()` semantics

### Requirement: Pageview and performance reporting SHALL have one clear owner

The system SHALL avoid counting the same pageview through both Umami automatic pageviews and the existing manual basic pageview event.

#### Scenario: Initial and SPA pageview

- **WHEN** a reporting-enabled page is initially loaded or the SPA route changes
- **THEN** the standard pageview SHALL be owned by the configured Umami tracker
- **AND** the application SHALL NOT emit a duplicate basic pageview solely through `app_page_view`

#### Scenario: Performance metrics

- **WHEN** page performance or Web Vitals are available
- **THEN** the application SHALL continue to report them as Umami custom events
- **AND** those events SHALL remain distinct from standard pageviews

### Requirement: PostHog runtime integration SHALL be removed

The Web application SHALL not load, call, allowlist, or silently filter PostHog as part of the active analytics implementation.

#### Scenario: Deployment policy is updated

- **WHEN** production or preview security headers are generated
- **THEN** the headers SHALL allow the configured Umami script and connection endpoints as required
- **AND** they SHALL not contain active PostHog analytics domains

#### Scenario: Service Worker observes analytics traffic

- **WHEN** the Service Worker handles an Umami or analytics-related request
- **THEN** it SHALL apply the intended pass-through/debug policy without routing the request through media caching
- **AND** no PostHog-specific runtime branch SHALL remain
