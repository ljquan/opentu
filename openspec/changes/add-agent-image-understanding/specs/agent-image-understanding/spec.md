## ADDED Requirements

### Requirement: Text Bindings Declare Image Understanding Capability

The system SHALL determine whether a text invocation can accept image input from the resolved text binding, instead of assuming every text model supports multimodal input.

#### Scenario: Supported text binding accepts image input

- **GIVEN** a text invocation resolves to a binding whose protocol supports image input
- **WHEN** the user sends a text request with one or more images
- **THEN** the system SHALL allow those images to be included in the outbound text request

#### Scenario: Unsupported text binding stays text-only

- **GIVEN** a text invocation resolves to a binding that does not support image input
- **WHEN** the user sends a text request with one or more images
- **THEN** the system SHALL NOT include image parts in the outbound request
- **AND** SHALL preserve the existing text-only behavior for that invocation

### Requirement: Chat Messages Can Carry Attached Images To Supported Text Models

The system SHALL allow chat messages to include attached images when the resolved text binding supports image understanding.

#### Scenario: Chat drawer sends attached image to OpenAI-compatible text protocol

- **GIVEN** the user attaches an image in the chat drawer
- **AND** the selected text binding resolves to `openai.chat.completions`
- **WHEN** the user sends the message
- **THEN** the outbound message SHALL include the user text and the attached image as multimodal message parts

#### Scenario: Chat drawer sends attached image to Google text protocol

- **GIVEN** the user attaches an image in the chat drawer
- **AND** the selected text binding resolves to `google.generateContent`
- **WHEN** the user sends the message
- **THEN** the outbound request SHALL include the user text and image content
- **AND** the image SHALL be converted into the Google-compatible payload shape before submission

### Requirement: Agent And AI Analyze Requests Preserve Real Reference Images

The system SHALL preserve real image inputs for Agent and AI analyze requests instead of reducing them to placeholder text only.

#### Scenario: Default Agent execution sends reference images

- **GIVEN** the Agent context contains one or more selected images
- **WHEN** the Agent builds the default user request
- **THEN** the request SHALL include the structured text prompt
- **AND** SHALL also include the selected images as message parts when the resolved text binding supports image input

#### Scenario: AI analyze workflow keeps image content across conversion

- **GIVEN** an `ai_analyze` workflow step is created from a request containing reference images
- **WHEN** that step is executed later
- **THEN** the workflow path SHALL preserve the reference image content needed for text-model image understanding
- **AND** SHALL not rely only on placeholder text to represent those images
