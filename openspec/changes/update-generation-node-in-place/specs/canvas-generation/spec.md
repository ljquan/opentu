## ADDED Requirements
### Requirement: In-place generation lifecycle
The canvas SHALL replace a submitted draft with progress at its current location and then with the generated media. Original inputs SHALL remain recoverable.

#### Scenario: Image or video submission
- **WHEN** a valid draft is submitted
- **THEN** progress occupies the draft location, input connections follow it, and no separate draft remains
- **AND** results use the current progress location and retain original inputs

#### Scenario: Multiple outputs
- **WHEN** a draft requests several images
- **THEN** the first slot uses the draft origin and subsequent slots avoid existing objects and reserved result envelopes

#### Scenario: Failure or cancellation
- **WHEN** generation fails or is cancelled
- **THEN** the progress card retains a restore-editing action with the original prompt, model, parameters and references
- **AND** restoring a failed batch slot requests only that slot on the next submission

#### Scenario: Recovery and clipboard
- **WHEN** a board is reloaded or exported and imported
- **THEN** original inputs survive with embedded reference media
- **WHEN** progress is copied
- **THEN** the copy is an editable draft without an active task identity

#### Scenario: Undo and reroll
- **WHEN** canvas lifecycle changes are undone or redone
- **THEN** no generation request is submitted by history replay
- **WHEN** an image result is rerolled
- **THEN** the existing result remains and the original inputs are used for the new generation
