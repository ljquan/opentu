## ADDED Requirements
### Requirement: Model Benchmark Workbench Tool
The system SHALL surface a "Model Benchmark Workbench" tool within the toolbox that can run benchmark sessions for text/image/video/audio modalities without inserting results into the canvas.

#### Scenario: Launching the benchmark workbench
- **GIVEN** the user opens the toolbox and selects the Model Benchmark Workbench
- **WHEN** the workbench loads
- **THEN** it SHALL present a session builder (same-model cross vendors, same-vendor cross models, custom combination) and default low-cost prompts for each modality
- **AND** SHALL allow the user to start, monitor, and stop benchmark entries, showing per-entry status, timings, and preview links.

### Requirement: Dedicated Benchmark Sessions
The system SHALL store benchmark sessions/results separately from the standard task queue, keeping for each entry the provider, model, modality, status, time-to-first-byte, completion time, estimated cost, preview, manual rating, and favorite/reject flags.

#### Scenario: Viewing past benchmark sessions
- **WHEN** the user reopens the benchmark workbench
- **THEN** previous sessions SHALL be listed with metadata and be filterable/sortable by speed, cost, rating, or favorite status.

### Requirement: Settings Shortcut Entry
The system SHALL add shortcut controls to each provider/model in the settings dialog that open the benchmark workbench with the corresponding provider, model, and modality pre-selected.

#### Scenario: Quick test from provider settings
- **GIVEN** a provider model entry rendering in the settings dialog
- **WHEN** the user clicks "快捷测试"
- **THEN** the settings dialog SHALL open the workbench window and pre-populate the session with the selected provider/model context so the user can submit the test immediately.
