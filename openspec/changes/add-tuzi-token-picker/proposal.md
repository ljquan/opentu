# Add distinct Tuzi token import and creation

## Why
The group picker conflates existing account tokens with new token creation and restores overly broad selections.

## What Changes
Use the approved A token list for import and new-token option 1 for creation. Import lists account-owned token names, groups and availability; only one eligible default token is preselected. Creation defaults to default only, supports a name and expandable groups, and previews one token per selected group. Preserve existing manual provider identities and restrictions.

## Impact
Tuzi authenticated list/import/atomic-create endpoints; OpenTu session API, provider persistence and account panel. No schema migration.

## Approval
The user selected import A and creation 1, and explicitly requested implementation in this conversation on 2026-09-29.
