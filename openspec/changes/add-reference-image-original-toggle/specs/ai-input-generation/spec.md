## ADDED Requirements

### Requirement: Taskbar Reference Image Fidelity Preference

The taskbar settings panel SHALL expose a locally persisted Keep Original Image switch independently of taskbar following and target centering.

#### Scenario: Enable original reference images
- **WHEN** the user enables Keep Original Image
- **THEN** subsequent shared reference-image processing SHALL skip optional lossy compression
- **AND** existing stored or previously compressed images SHALL NOT be rewritten or claimed as restored

#### Scenario: Disable original reference images
- **WHEN** the user disables Keep Original Image
- **THEN** subsequent shared reference-image processing SHALL use the existing compression policy
- **AND** the taskbar following and target centering preferences SHALL remain unchanged

#### Scenario: Storage is unavailable
- **WHEN** saving the preference is denied by browser storage
- **THEN** the application SHALL retain the selected preference for the current page session

#### Scenario: First use prioritizes transfer size
- **WHEN** the user has not saved a Keep Original Image preference
- **THEN** the switch SHALL be disabled
- **AND** existing compression behavior SHALL remain active
