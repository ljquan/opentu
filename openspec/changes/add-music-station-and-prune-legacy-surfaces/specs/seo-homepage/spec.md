## REMOVED Requirements

### Requirement: Localized SEO homepage
**Reason**: The React product home is now the single user-facing root entry and
the duplicated static SEO pages are removed.
**Migration**: Legacy static URLs redirect to `/` at the deployment boundary.

### Requirement: Localized homepage alternates
**Reason**: The duplicate localized static entry points are no longer shipped.
**Migration**: Use the canonical React home at `/`.

### Requirement: Localized homepage discovery
**Reason**: The sitemap must not advertise removed static pages.
**Migration**: The sitemap advertises `/` and the new `/music-station` route.
