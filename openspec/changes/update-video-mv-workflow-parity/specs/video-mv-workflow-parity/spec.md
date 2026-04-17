## ADDED Requirements
### Requirement: Script Page Character Editing Parity
The system SHALL let users edit detected character descriptions in the video analyzer script page, using the same interaction pattern as the MV creator.

#### Scenario: Edit character descriptions in video analyzer
- **GIVEN** a video analyzer record contains detected characters
- **WHEN** the user edits a character description on the script page
- **THEN** the updated description is persisted on the record
- **AND** subsequent generation uses the updated character description

### Requirement: Shared Generation Reset
The system SHALL provide a consistent "reset generated assets" action for both video analyzer and MV creator generation pages.

#### Scenario: Reset generation assets
- **GIVEN** a record has generated first frames, last frames, videos, or character reference images
- **WHEN** the user clicks the reset action
- **THEN** generated asset URLs and suppressed generated URLs are cleared
- **AND** character reference images are cleared
- **AND** script content, selected models, and workflow versions remain unchanged

### Requirement: Shared ZIP Export Contract
The system SHALL export generated workflow assets from both video analyzer and MV creator using the same ZIP manifest contract.

#### Scenario: Export video analyzer assets
- **GIVEN** a video analyzer record has generated assets
- **WHEN** the user exports the workflow assets
- **THEN** the ZIP contains the script markdown, manifest file, download helper script, and generated shot assets
- **AND** the manifest keeps the shared structure used by MV creator
- **AND** music-related fields are empty when no music asset exists

#### Scenario: Export MV creator assets
- **GIVEN** an MV creator record has generated assets and optionally a selected music clip
- **WHEN** the user exports the workflow assets
- **THEN** the ZIP contains the shared manifest structure plus the selected music asset when available
