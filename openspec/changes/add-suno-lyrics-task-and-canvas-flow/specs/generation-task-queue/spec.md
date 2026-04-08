## ADDED Requirements

### Requirement: Represent Lyrics Tasks In The Queue Without Audio Asset Assumptions

The task queue SHALL support completed Suno lyrics tasks even when the result does not contain a media URL.

#### Scenario: Queue item shows lyrics-specific summary after completion

- **GIVEN** a Suno lyrics task has completed successfully
- **WHEN** the task is rendered in the queue
- **THEN** the queue SHALL show that the task action is lyrics generation
- **AND** SHALL display available semantic fields such as title, tags, or a lyrics excerpt
- **AND** SHALL not render the task as if it were a playable audio card

#### Scenario: Lyrics task survives persistence and refresh recovery

- **GIVEN** a completed lyrics task has been written to browser storage
- **WHEN** the application restores tasks after a refresh or session recovery
- **THEN** the restored task SHALL keep its normalized lyrics result fields
- **AND** the queue SHALL still be able to show the same lyrics summary and status

### Requirement: Provide Lyrics-Specific Queue Actions

The task queue SHALL expose follow-up actions appropriate for lyrics results.

#### Scenario: Copy lyrics text from the queue

- **GIVEN** a completed lyrics task exists in the queue
- **WHEN** the user chooses a copy action
- **THEN** the system SHALL copy the generated lyrics text rather than trying to open or download an audio URL

#### Scenario: Insert lyrics into the canvas from the queue

- **GIVEN** a completed lyrics task exists in the queue
- **WHEN** the user chooses to insert the result
- **THEN** the queue SHALL route the insertion through the text insertion path
- **AND** SHALL not attempt to insert an audio node for that task
