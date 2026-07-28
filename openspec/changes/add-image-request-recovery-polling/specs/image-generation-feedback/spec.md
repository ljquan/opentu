## ADDED Requirements

### Requirement: Recovering Image Tasks SHALL Remain Visibly In Progress

The system SHALL represent automatic Request-ID recovery after a formal POST attempt as continued image processing instead of an interruption failure.

#### Scenario: User views a task while recovery polling is active

- **GIVEN** an image task formally submitted its POST and then ambiguously lost the response
- **AND** Request-ID recovery is still within the allowed time window
- **WHEN** the task queue or image generation feedback is rendered
- **THEN** the task SHALL appear as generating or recovering
- **AND** SHALL NOT show `任务被中断（页面刷新）`

#### Scenario: Error occurs before formal submission

- **GIVEN** an image task fails during preprocessing, validation, or request construction before the formal POST
- **WHEN** task feedback is rendered
- **THEN** the task SHALL show the real failure
- **AND** SHALL NOT appear as recovering or polling

#### Scenario: Recovery reaches a terminal result

- **WHEN** automatic recovery receives an upstream success or failure
- **THEN** existing task feedback SHALL transition to the recovered image or the real upstream error
- **AND** no separate manual Request-ID recovery panel SHALL be required
