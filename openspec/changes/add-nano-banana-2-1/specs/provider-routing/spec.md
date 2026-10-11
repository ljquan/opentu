## ADDED Requirements
### Requirement: Tuzi Nano Banana 2.1 Google Binding
The system SHALL infer a Google generateContent image binding for the exact `gemini-nano-banana-2.1` model on Tuzi providers, retaining the selected provider's auth strategy.

#### Scenario: Tuzi root or v1 base URL
- **WHEN** the model is invoked through a Tuzi profile with a root or `/v1` base URL
- **THEN** the endpoint SHALL resolve to `/v1beta/models/gemini-nano-banana-2.1:generateContent`
- **AND** SHALL NOT resolve to `/images/generations`

#### Scenario: Existing models and generic gateways
- **WHEN** bindings are inferred for older Gemini models, GPT Image, or a generic OpenAI-compatible provider
- **THEN** this new exact-model Tuzi rule SHALL NOT change their binding behavior
