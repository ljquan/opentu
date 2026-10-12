## ADDED Requirements

### Requirement: Scoped Video Parameters Reach Their Final Consumers

The system SHALL serialize supported video parameters according to the selected provider binding and confirmed downstream channel contract rather than only the model family name.

#### Scenario: Seedance 2.0 keeps the official baseline scope

- **WHEN** `doubao-seedance-2-0-260128` or its scoped fast variant is selected
- **THEN** the client SHALL preserve existing duration, resolution, ratio and media inputs
- **AND** SHALL NOT expose a watermark control without official model support evidence

#### Scenario: H3 watermark additions are cancelled

- **WHEN** H3 submits generation, regeneration or Context IR requests
- **THEN** this change SHALL preserve baseline request construction
- **AND** SHALL NOT add aigc_watermark

### Requirement: Veo Advanced Parameter Mapping

The system SHALL expose the four `veo3.1` advanced controls without requiring a channel support declaration, map selected values to multipart metadata, validate their types and configured value limits, and preserve explicit false and zero values. Exposure SHALL NOT imply verified supplier support.

#### Scenario: Tuzi Gemini metadata path

- **GIVEN** the selected model is `veo3.1`, including a binding without a capability declaration
- **WHEN** `generate_audio` is false, `seed` is 0, and a negative prompt is provided
- **THEN** FormData SHALL include valid JSON metadata with `generateAudio: false`, `seed: 0`, and `negativePrompt`
- **AND** SHALL NOT rely on unsupported top-level snake_case fields

#### Scenario: Native Gemini advanced path remains outside delivery

- **WHEN** delivery coverage is reported
- **THEN** native Gemini predictLongRunning advanced mapping SHALL remain explicitly unimplemented
- **AND** multipart metadata tests SHALL NOT be presented as native Gemini validation

### Requirement: Unknown Downstream Capability Does Not Imply Support

The system SHALL distinguish a local adapter writing a field from a downstream channel consuming it and SHALL report unsupported or unconfirmed user-selected capabilities explicitly.

#### Scenario: Seedance 2.5 retains existing fields and removes unsupported fields

- **WHEN** Seedance 2.5 is selected
- **THEN** existing watermark and output_format request behavior SHALL remain
- **AND** draft and priority SHALL NOT appear in controls or outgoing requests, including legacy preferences
- **AND** delivery documentation SHALL NOT claim verified downstream output format

#### Scenario: Tuzi Gemini lacks Veo last-frame conversion

- **GIVEN** the selected Tuzi channel lacks lastFrame conversion
- **WHEN** media capability coverage is reported
- **THEN** the limitation SHALL be attributed to that downstream path
- **AND** SHALL NOT disable existing supported first/last-frame paths for other channels
