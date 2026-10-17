## ADDED Requirements

### Requirement: Published server catalog boundary

The public model marketplace SHALL show only models whose provider is enabled,
whose latest provider health state is healthy, and whose model record is
explicitly published by an administrator.

#### Scenario: Unpublished model is hidden

- **WHEN** a model exists in a successful provider sync but `published` is
  false
- **THEN** the public catalog endpoint and model marketplace omit it

#### Scenario: Published model becomes unavailable

- **WHEN** a provider is disabled or its latest health check fails
- **THEN** all of its models disappear from the public catalog without exposing
  provider credentials

#### Scenario: Public catalog response

- **WHEN** a user requests the public model catalog
- **THEN** the response contains safe model metadata, provider display name,
  category, and availability state, but no API key or secret-bearing fields
