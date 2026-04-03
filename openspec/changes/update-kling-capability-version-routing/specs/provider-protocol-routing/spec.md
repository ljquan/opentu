## ADDED Requirements

### Requirement: Resolve Standard Kling Video Capability Separately From Executable Versions

The system SHALL treat standard Kling video capability identifiers separately from the executable version strings required by submit requests.

#### Scenario: Discovered Kling capability is not submitted as executable version directly

- **GIVEN** a provider profile exposes the discovered standard Kling video capability `kling_video`
- **WHEN** the user submits a standard Kling video generation request
- **THEN** the system SHALL route the request through the standard Kling video binding
- **AND** SHALL send the executable version through the request field `model_name`
- **AND** SHALL not assume that `kling_video` itself is a valid executable version string

#### Scenario: Legacy Kling version-style model IDs remain executable

- **GIVEN** an existing task or setting still references a legacy standard Kling model ID such as `kling-v1-6`
- **WHEN** the request is executed through the current runtime
- **THEN** the system SHALL continue to accept that input
- **AND** SHALL interpret it as an explicit `model_name` for the standard Kling binding
- **AND** SHALL keep the request on the standard Kling submit and poll endpoints

### Requirement: Validate Standard Kling Version Choices Against The Selected Action

The system SHALL validate standard Kling executable versions against the selected submit action.

#### Scenario: Text-to-video allows the current standard Kling version set

- **GIVEN** the standard Kling request resolves to `text2video`
- **WHEN** the runtime selects or receives an executable version
- **THEN** the system SHALL allow only the versions supported by the text-to-video endpoint
- **AND** SHALL include `kling-v2-6` in that allowed set when provided by binding metadata

#### Scenario: Image-to-video allows the extended Kling version set

- **GIVEN** the standard Kling request resolves to `image2video`
- **WHEN** the runtime selects or receives an executable version
- **THEN** the system SHALL allow the versions supported by the image-to-video endpoint
- **AND** SHALL include `kling-v2-6` in that allowed set when provided by binding metadata

#### Scenario: Image-to-video still requires a reference image

- **GIVEN** the standard Kling request resolves to `image2video`
- **WHEN** the user submits the request without a reference image
- **THEN** the system SHALL fail validation before submit
- **AND** SHALL not send an invalid image-to-video request to the provider

### Requirement: Exclude Non-Standard Kling O1 Models From Standard Kling Capability Routing

The system SHALL keep `kling-video-o1` style models outside the standard Kling capability routing path.

#### Scenario: O1 model does not reuse standard Kling submit action routing

- **GIVEN** the selected video model is `kling-video-o1` or `kling-video-o1-edit`
- **WHEN** the runtime resolves provider protocol bindings
- **THEN** the system SHALL not treat that model as the standard `kling_video` capability
- **AND** SHALL not force it through the standard `/kling/v1/videos/{action}` routing and version validation rules

### Requirement: Enforce Standard Kling Numeric Parameter Constraints Before Submit

The system SHALL enforce the documented numeric constraints for standard Kling video requests before submit.

#### Scenario: cfg_scale stays within the documented range

- **GIVEN** a standard Kling request includes `cfg_scale`
- **WHEN** the request is prepared for submit
- **THEN** the system SHALL accept only values in the inclusive range `[0, 1]`
- **AND** SHALL fail validation before submit when the value falls outside that range

#### Scenario: camera_control uses bounded integer values

- **GIVEN** a standard Kling text-to-video request includes `camera_control` values through flat params or a nested `camera_control` object
- **WHEN** the request is prepared for submit
- **THEN** the system SHALL accept only integer values in the inclusive range `[-10, 10]` for `horizontal`, `vertical`, `pan`, `tilt`, `roll`, and `zoom`
- **AND** SHALL fail validation before submit when any of those values is non-integer or out of range
