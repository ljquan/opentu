## MODIFIED Requirements

### Requirement: Image Generation Anchors SHALL Defer Detailed Execution History To Task Details

The system SHALL keep canvas anchors lightweight and defer detailed execution history to the task detail layer, while preserving enough target-level metadata to support prompt editing and result replacement.

#### Scenario: Canvas anchor shows only concise progress context
- **WHEN** an image generation anchor is rendered in the canvas
- **THEN** it SHALL prioritize stage, lightweight progress, direct recovery actions, and target binding status
- **AND** SHALL NOT default to rendering the full workflow step list inside the canvas object

#### Scenario: Users need detailed failure or history information
- **WHEN** the user requests more detail about an image generation task
- **THEN** the system SHALL provide that information through the task detail layer
- **AND** the anchor MAY offer a navigation affordance without becoming the primary detail container

## ADDED Requirements

### Requirement: Image Generation Results SHALL Preserve Target Binding Metadata

The system SHALL preserve lightweight binding metadata between image generation anchors, tasks, prompts, and inserted image elements, using the same prompt and task identity fields consumed by cross-media target controls.

#### Scenario: Image result is inserted from an anchor
- **GIVEN** an image generation request created a canvas anchor
- **WHEN** the generated image is inserted into the canvas
- **THEN** the inserted image element SHALL retain the prompt and task identity as lightweight metadata
- **AND** the related anchor SHALL be able to identify the inserted result element
- **AND** the metadata SHALL remain compatible with the shared generated-target prompt resolver

#### Scenario: Task history is later unavailable
- **GIVEN** a generated image remains on the canvas
- **AND** the detailed task history has been archived or removed
- **WHEN** the user opens the target-level prompt control
- **THEN** the control SHALL still recover the stored prompt from the image element metadata
