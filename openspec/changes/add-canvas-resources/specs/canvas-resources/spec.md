## ADDED Requirements

### Requirement: Canvas download entry
The canvas SHALL provide a download button above the feedback entry and in the collapsed mobile toolbar. Selecting it SHALL open a confirmation dialog explaining that Tuzi Assistant includes OpenTu desktop and that confirmation opens the official download page. The dialog SHALL provide confirm and cancel actions in the selected language.

#### Scenario: Confirm download
- **WHEN** the user selects the download button and confirms
- **THEN** https://tuziapi.github.io/tuzi-switch/#td-r0-downloads opens in a new tab with noopener and noreferrer
- **AND** the dialog closes

#### Scenario: Cancel download
- **WHEN** the user cancels or dismisses the download dialog
- **THEN** the dialog closes without opening the download page

### Requirement: Community and updates
The existing feedback popover SHALL display the feedback QR code and the OpenTu X profile link together, without a Tuzi Assistant download card. It SHALL fit the viewport.

#### Scenario: Open community
- **WHEN** the user selects the feedback button
- **THEN** the community QR code and a link to https://x.com/shuidiyuAI appear together
- **AND** the profile link opens in a new tab with noopener and noreferrer

### Requirement: Manual entry only
The canvas SHALL NOT automatically open a resources panel or download dialog, regardless of previous announcement acknowledgement state.

#### Scenario: First visit or reload
- **WHEN** the user opens or reloads the canvas with or without the old acknowledgement key
- **THEN** both the download dialog and feedback popover remain closed until selected

### Requirement: API Key support QR codes
The missing API Key dialog SHALL display the supplied original community and support QR images at their original aspect ratios. The dialog SHALL retain its credential persistence and cancellation behavior and fit narrow or short viewports with vertical scrolling when necessary.

#### Scenario: Missing API Key
- **WHEN** the user submits an image prompt without configured credentials
- **THEN** the API Key dialog shows the API token and video tutorial links, OpenTu community QR, and WeChat support QR
- **AND** both images remain scannable and cancellation closes the dialog without saving credentials
