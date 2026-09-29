## ADDED Requirements

### Requirement: Complete OpenTu model coverage

The system MUST adapt workflow configuration and execution for every existing OpenTu model capability across image, video, text and audio. The coverage set MUST include the full built-in catalog, enabled-provider discovered models, manually bound models and default-route models, with distinct provider/model/capability identities. Coverage MUST NOT be restricted to selected defaults, checked models or examples in screenshots.

#### Scenario: Audit the complete catalog

- **WHEN** adaptation coverage is checked against the current OpenTu catalog
- **THEN** every model identity has a record of its parameter definitions, input roles, invocation consumer, result handling and verification evidence or specific missing upstream contract
- **AND** shared family implementations do not remove the requirement to check each model's supported fields and defaults
- **AND** existing host capabilities missing workflow support are recorded as unfinished work rather than unsupported model features

#### Scenario: Add a model or parameter

- **WHEN** the host catalog gains a model or a supported parameter
- **THEN** coverage verification detects a missing model record or request mapping
- **AND** the workflow uses the current host description without requiring a duplicated hardcoded model form

#### Scenario: Assess overall completion

- **WHEN** a single model or a subset of representative models passes verification
- **THEN** the full adaptation remains incomplete until all existing host capabilities in the coverage set are accounted for and supported by the workflow
- **AND** hiding models or disabling a host-supported setting does not satisfy completion

### Requirement: Host-owned model parameter descriptions

The system MUST obtain parameter descriptions for native workflow models from OpenTu's current model definitions and invocation bindings, keyed by provider profile, model and capability. Descriptions MUST contain only serializable configuration metadata and MUST NOT contain credentials or executable code.

#### Scenario: Refresh a model catalog

- **WHEN** the workflow receives refreshed native model metadata
- **THEN** it uses the current parameter descriptions and availability for each provider/model identity
- **AND** existing custom scripts and node parameter values are preserved
- **AND** models no longer available cannot be submitted through a stale selection

#### Scenario: Unknown model capability details

- **WHEN** a native model has no verified parameter description or invocation consumer
- **THEN** the workflow exposes only confirmed controls and identifies unavailable capabilities
- **AND** it does not assign another model's defaults or generic video options

### Requirement: Model-specific settings and summaries

The system MUST render settings from the selected model's supported parameter values, defaults and constraints. The visible summary and execution request MUST use the same effective values. Resolution, pixel dimensions, aspect ratio, quality, duration and generation mode MUST retain their model-specific meanings.

#### Scenario: Select MiniMax-H3

- **WHEN** the user selects the current built-in MiniMax-H3 model
- **THEN** resolution options are 768P and 2K, duration options are 4 through 15 seconds, and ratio and V1/V2 are independently configurable
- **AND** an unconfigured node uses the host defaults of 768P, 5 seconds, 16:9 and V1
- **AND** the workflow does not offer generic 480p/720p/1080p or arbitrary pixel sizes for that model

#### Scenario: Model-specific image and audio controls

- **WHEN** the user selects an image, TTS or Suno model
- **THEN** the controls reflect that model's supported parameters and result capabilities
- **AND** unsupported parameters are not presented as effective editable settings

### Requirement: Isolated and persistent parameter state

The system MUST persist node parameters separately for each provider/model/capability identity and MUST share effective-value resolution across node composers, configuration nodes, workbench generation and retries.

#### Scenario: Switch models and restore

- **WHEN** a node changes from model A to model B and back to A, including after reload
- **THEN** valid saved values for A are restored
- **AND** B's parameters do not enter A's request
- **AND** other nodes and host defaults are unchanged

#### Scenario: A saved value becomes unsupported

- **WHEN** current host metadata no longer permits a saved value
- **THEN** the workflow identifies the invalid setting and prevents submission until it is corrected
- **AND** it does not silently send a substituted value

### Requirement: Validated end-to-end parameter delivery

The system MUST validate native requests against the current host model identity, parameter allowlist, types, enumerations, numeric constraints and conditional requirements before invoking a provider. Every enabled setting MUST map to a verified request consumer.

#### Scenario: Send MiniMax-H3 settings

- **WHEN** the user generates with 2K, a supported duration and ratio, and API version V2
- **THEN** those values reach the existing H3 request builder and V2 routing
- **AND** no generic pixel conversion or automatic p suffix changes 2K

#### Scenario: Invalid or unknown request fields

- **WHEN** a bridge request includes an invalid enum, unsupported duration, wrong type or undeclared parameter
- **THEN** the host rejects it before the provider request
- **AND** parameter data cannot override the model binding, credentials or executable callbacks

#### Scenario: Text configuration reaches execution

- **WHEN** native text generation includes system instructions, conversation context and supported generation parameters
- **THEN** the host text executor receives these values with their roles and types intact
- **AND** the request is not reduced to only the last prompt

### Requirement: Reference media semantics

The system MUST retain reference media order and declared roles through node connections, persistence and native execution, and MUST enforce the selected model's existing input capabilities.

#### Scenario: First and last frame generation

- **WHEN** a model supporting first/last frames receives both inputs
- **THEN** each input reaches the matching role in the provider request
- **AND** a reference-image mode is not silently substituted

#### Scenario: Unsupported reference input

- **WHEN** a user supplies video, audio or image roles unsupported by the resolved adapter
- **THEN** the workflow reports the specific unsupported input before generation
- **AND** it does not silently discard the input or truncate references

### Requirement: Typed native generation results

The system MUST preserve the result type returned by supported native generation operations and route results to the originating workflow document and node.

#### Scenario: Generate Suno lyrics

- **WHEN** a supported Suno lyrics operation completes
- **THEN** its text is saved in a text node with generation metadata
- **AND** it is not treated as a missing audio URL

#### Scenario: Multiple audio clips

- **WHEN** an audio operation returns multiple supported clips
- **THEN** all valid returned clips remain accessible in the workflow result
- **AND** switching to the normal whiteboard does not change result ownership

### Requirement: Preserve custom invocation behavior

The system MUST preserve existing custom channel scripts and normal whiteboard behavior while applying model parameter adaptation to native workflow generation.

#### Scenario: Model has a custom script

- **WHEN** generation targets a model with an existing custom script
- **THEN** existing script invocation takes precedence
- **AND** native catalog synchronization does not overwrite the script

### Requirement: Evidence-based acceptance

The system MUST have focused local verification for each enabled parameter's request mapping, model switching, persistence, reference roles and result handling. Local verification MUST be distinguished from live provider acceptance.

#### Scenario: Finish local verification

- **WHEN** contract, request and browser checks pass without live provider requests
- **THEN** delivery records the verified local coverage and remaining provider acceptance explicitly
- **AND** it does not claim supplier availability, credits or successful paid generation
