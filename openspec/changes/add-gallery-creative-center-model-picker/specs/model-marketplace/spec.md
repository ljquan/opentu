## ADDED Requirements

### Requirement: Focused model picker

The platform SHALL provide a responsive model picker overlay with category
navigation, search, model details, and a direct creation action.

#### Scenario: Open the model picker

- **WHEN** a user selects 模型广场 from the home navigation
- **THEN** a large overlay opens without scrolling the home page to a model
  section

#### Scenario: Select a model

- **WHEN** a user selects a model and confirms its use
- **THEN** the platform routes to the corresponding creation surface with the
  model identifier preserved in the URL
