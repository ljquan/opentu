# Change: Add canvas resources and first-use announcement

## Why
Users need desktop downloads and the OpenTu X account within the canvas. The user approved the canvas toolbar mock and requested an announcement when first opening the release containing this feature.

## What Changes
- Add an OpenTu resources button above feedback in the canvas toolbar, including the collapsed mobile toolbar.
- Open the anchored resources panel on first use and keep it open until explicitly closed.
- Record this announcement when first displayed so refreshing cannot trigger it again, while allowing manual reopening from the toolbar.
- Add the original community and support QR images to the API Key dialog and refine its responsive layout.

## Impact
- Affected specs: canvas-resources
- Affected code: canvas toolbar, resources component, i18n, API Key dialog
