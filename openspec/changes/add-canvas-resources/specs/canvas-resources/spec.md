## ADDED Requirements

### Requirement: Canvas resources entry
The canvas SHALL provide an OpenTu resources button above the feedback entry and in the collapsed mobile toolbar. The panel SHALL contain the desktop download URL and X profile URL, opened in a new tab with noopener and noreferrer.

#### Scenario: Open resources
- **WHEN** the user selects the resources button
- **THEN** an anchored panel displays links to https://aiw520.github.io/opentuAI/download.html and https://x.com/shuidiyuAI
- **AND** the panel fits the viewport and can be explicitly closed

### Requirement: First-use announcement
The canvas SHALL automatically show the panel on first opening the release containing this announcement. It SHALL record this fixed announcement as shown immediately and SHALL avoid automatically opening it on subsequent launches or future releases. Manual reopening SHALL remain available.

#### Scenario: Update without acknowledgement
- **WHEN** a user opens the updated canvas without an acknowledgement for this announcement
- **THEN** the resources panel opens automatically
- **AND** the announcement is recorded immediately, while outside clicks and resource navigation do not close it

#### Scenario: Reload before closing
- **WHEN** the user reloads after the first automatic display without explicitly closing it
- **THEN** the panel does not open automatically again

#### Scenario: Acknowledgement and reopening
- **WHEN** the user closes the resources panel explicitly
- **THEN** the panel closes
- **AND** the panel does not automatically open on reload but remains accessible from the toolbar

#### Scenario: Unavailable local storage
- **WHEN** browser local storage is unavailable
- **THEN** the canvas remains usable and acknowledgement is retained for the current page session

### Requirement: API Key support QR codes
The missing API Key dialog SHALL display the supplied original community and support QR images at their original aspect ratios. The dialog SHALL retain its credential persistence and cancellation behavior and fit narrow or short viewports with vertical scrolling when necessary.

#### Scenario: Missing API Key
- **WHEN** the user submits an image prompt without configured credentials
- **THEN** the API Key dialog shows the API token and video tutorial links, OpenTu community QR, and WeChat support QR
- **AND** both images remain scannable and cancellation closes the dialog without saving credentials
