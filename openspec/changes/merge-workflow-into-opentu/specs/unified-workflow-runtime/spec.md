## ADDED Requirements

### Requirement: Unified workflow runtime

OpenTu SHALL serve the workflow pages from the same React application, Vite module graph, development server, and production build as the ordinary canvas.

#### Scenario: Open workflow in development

- **WHEN** a user navigates to `/workflow` in the OpenTu development server
- **THEN** the workflow renders without requiring a generated `workflow-app` directory or iframe
- **AND** changes to workflow source participate in the same HMR module graph

#### Scenario: Build OpenTu

- **WHEN** OpenTu runs its normal development or production build command
- **THEN** workflow route modules are included through the main application build
- **AND** a separate workflow prebuild is not required

### Requirement: Direct OpenTu integration

The workflow SHALL call OpenTu model discovery, defaults, provider settings, generation, cancellation, and error handling through in-process adapters without `postMessage` or `window.parent` communication.

#### Scenario: Native generation

- **WHEN** a workflow node submits a request for an OpenTu-bound model
- **THEN** the request reaches the existing OpenTu adapter with the selected profile, model, parameters, and references
- **AND** the result or typed error returns to the workflow without an iframe bridge

#### Scenario: Generation cancellation

- **WHEN** a workflow request is cancelled
- **THEN** the direct adapter receives the cancellation signal and the workflow clears the pending request state

#### Scenario: Local channel credential autofill

- **WHEN** a user opens a local channel editor with an empty key and the default endpoint
- **THEN** the editor reads enabled, configured, compatible OpenTu profiles and fills URL, API Key and protocol from the preferred image route, default group or sole candidate
- **AND** the user can explicitly choose a different group, including groups sharing the same endpoint and profiles without a model catalog
- **AND** existing credentials and manual input during initialization are preserved; a custom endpoint only autofills from a matching endpoint and protocol
- **AND** saving persists the local channel copy while cancelling leaves stored configuration unchanged; native model sync continues to omit credentials

### Requirement: Stable workflow route and persistence

The unified application SHALL preserve the `/workflow` entry route, browser refresh behavior, workflow internal navigation, and existing workflow local storage and import/export formats.

#### Scenario: Refresh workflow route

- **WHEN** a user refreshes `/workflow` or an internal workflow route
- **THEN** the same workflow page opens through the main application route
- **AND** existing workflow records remain readable

#### Scenario: Existing workflow data

- **WHEN** a user opens workflow data created before the runtime merge
- **THEN** the data is read using the existing storage keys and record schema
- **AND** the merge does not silently delete or rewrite it

### Requirement: Runtime isolation for ordinary canvas

The unified workflow SHALL keep workflow styles and global effects from changing ordinary canvas behavior, layout, theme, or provider routing.

#### Scenario: Return to ordinary canvas

- **WHEN** a user exits workflow mode
- **THEN** the ordinary canvas renders with its existing route, theme, shortcuts, and provider behavior
- **AND** workflow-only resources are unloaded or left behind only according to the route's lazy-loading policy
