## ADDED Requirements

### Requirement: Search Available Models

The workflow model picker SHALL provide a search field fixed above its scrollable model list. It SHALL filter the existing capability-eligible options using case-insensitive substring matching against model names and channel group names after trimming the query.

#### Scenario: Search by model name
- **WHEN** the user enters ` DEEPSEEK ` into an open model picker
- **THEN** only eligible options whose model name or group name contains `deepseek`, ignoring case, are displayed in their existing order
- **AND** the currently selected model remains unchanged

#### Scenario: Search by group name
- **WHEN** the user enters a channel group name
- **THEN** eligible models in matching groups are displayed with their original channel identities

#### Scenario: No matching options
- **WHEN** configured eligible models exist but none match the query
- **THEN** the menu displays a non-selectable no-results message and retains the editable search field

#### Scenario: Clear or reopen the menu
- **WHEN** the user clears the search or reopens the picker
- **THEN** the query is empty and all options allowed by the existing capability filter are shown
- **AND** the previous selection is retained

### Requirement: Search Interaction And Selection

The picker SHALL focus the search field on opening, support ordinary text and IME input without unintended selection, and preserve pointer and keyboard selection of filtered options. The field SHALL remain visible while results scroll and use existing theme styling and responsive menu constraints.

#### Scenario: Type using an input method
- **WHEN** the user enters spaces or composes Chinese text in the search field
- **THEN** menu typeahead does not steal focus and composition confirmation does not select a model

#### Scenario: Choose a filtered model
- **WHEN** the user clicks a filtered option or navigates to it using arrow keys and confirms with Enter
- **THEN** the existing selection callback receives that option's original value and the menu closes

#### Scenario: Dismiss without selection
- **WHEN** the user presses Escape or dismisses the menu without choosing a result
- **THEN** the selected model is unchanged

#### Scenario: Scroll results
- **WHEN** matching results exceed the menu's available height
- **THEN** results scroll while the search field remains visible within the viewport
