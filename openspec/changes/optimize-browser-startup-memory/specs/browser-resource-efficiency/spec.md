## ADDED Requirements

### Requirement: Preserve Existing Features And Stored User Data

The optimization SHALL preserve supported existing canvas, workflow, media, history, editing, export, preferences and generation-recovery behavior. Cold-resource eviction SHALL affect runtime resources only and SHALL NOT remove the sole persistent copy of user content. Compatibility SHALL take precedence over performance targets.

#### Scenario: Existing project has no new preview

- **WHEN** an existing user opens a stored project without a new preview artifact
- **THEN** the original media and recorded dimensions SHALL remain readable
- **AND** the system SHALL regenerate an optional preview or fall back to the original without destructive migration

#### Scenario: Shared resource remains active

- **WHEN** a canvas, editor, export or playback still needs a resource
- **THEN** closing another consumer or reaching a cold-cache budget SHALL NOT invalidate that resource
- **AND** undo and redo SHALL retain access to their required original content

#### Scenario: Existing feature regresses

- **WHEN** optimization causes a critical regression such as lost content, failed original-media operations, blank startup or duplicate generation
- **THEN** the affected batch SHALL NOT be accepted for release based on performance improvement alone

### Requirement: Remain Compatible Across Application Updates

The optimization SHALL preserve the established user-confirmed update flow, version-correct static resources and cross-version persistent media. Compatibility acceptance SHALL cover supported previous-version data, old and new page/Service Worker combinations, interrupted updates and deployment rollback.

#### Scenario: Old page remains open during an update

- **WHEN** a previous-version page remains open while a new version becomes available
- **THEN** its later lazy-resource requests SHALL remain compatible with that page
- **AND** the optimization SHALL NOT force a reload or revoke media still used by that page

#### Scenario: Update resources are incomplete

- **WHEN** critical new-version resources are unavailable due to offline state, interrupted download or delayed deployment
- **THEN** the previous usable version and user data SHALL remain available
- **AND** failure to fetch optional previews or prefetch groups SHALL NOT block the established critical update readiness flow

#### Scenario: New page communicates with an older Service Worker

- **WHEN** a new page encounters a supported older Service Worker or the reverse combination
- **THEN** optional resource-management capabilities SHALL be detected or use a compatible fallback
- **AND** original media keys and generation-recovery semantics SHALL remain valid

#### Scenario: Deployment is rolled back

- **WHEN** deployment returns to the supported previous application version
- **THEN** stored projects and original media written or used during optimization SHALL remain readable through the approved rollback path
- **AND** incompatible or unknown persisted formats SHALL NOT be overwritten or deleted to force startup

#### Scenario: Storage migration is required

- **WHEN** a later optimization phase requires a persisted format change
- **THEN** its compatibility and migration design SHALL be separately approved and verified
- **AND** a recoverable original snapshot SHALL be retained until the new representation is complete and validated

### Requirement: Prioritize Interactive Canvas Startup

The system SHALL prioritize rendering the current canvas and its visible content over nonessential asset scans, metadata enrichment and unrelated page initialization. Necessary task recovery and persistence SHALL remain reliable.

#### Scenario: Open a populated canvas

- **WHEN** a user opens a canvas containing visible and offscreen media
- **THEN** the system SHALL make canvas interactions available without first loading every original media resource
- **AND** ordinary canvas images SHALL start loading their original source or cached image on mount without requiring visibility callbacks or selection
- **AND** workflow media SHALL be loaded when needed by visibility or an explicit operation
- **AND** asset-library scans and unrelated workflow pages SHALL NOT be prerequisites for canvas interaction

#### Scenario: Restore an interrupted generation

- **WHEN** a paid generation task requires recovery during startup
- **THEN** deferred nonessential work SHALL NOT lose its task ID, original invocation route or required inputs
- **AND** startup optimization SHALL NOT duplicate generation submissions

### Requirement: Preserve Original Media While Reducing Display Cost

The system SHALL use display-appropriate workflow image previews and lightweight video covers where available while preserving the original resources for preview, editing, download, export and generation inputs. Ordinary canvas images SHALL retain automatic original-source loading.

#### Scenario: Image size changes with zoom

- **WHEN** a visible workflow image can be rendered clearly using an existing preview
- **THEN** the system SHALL render that preview without unnecessarily retaining its original decoded resource
- **WHEN** an explicit operation or display size requires the original
- **THEN** the system SHALL obtain the original without modifying the stored source or output dimensions

#### Scenario: Video has not been played

- **WHEN** a canvas video has a cover and no active playback intent
- **THEN** the system SHALL avoid loading the full video solely to render its cover
- **AND** playback, seeking, offline fallback and signed URL behavior SHALL remain available on demand

### Requirement: Bound Runtime Resources With Ownership

The system SHALL manage temporary URLs and cold media caches with explicit consumer ownership and approved byte budgets. Runtime eviction SHALL NOT delete persistent source data or invalidate resources still required by active operations or undo history.

#### Scenario: Legacy node retains a replaced URL

- **WHEN** legacy node or history data directly retains an older resource URL during a stored media replacement
- **THEN** that URL SHALL remain valid until explicit deletion or a verified release by all consumers
- **AND** pending reads for the replaced version SHALL NOT overwrite the current URL cache

#### Scenario: Metadata or preview work times out

- **WHEN** a metadata or preview operation reaches the approved processing timeout
- **THEN** its caller or queue SHALL settle rather than wait indefinitely
- **AND** temporary image, media, canvas and bitmap resources SHALL be cleaned up, including late decoder completions
- **AND** timeout SHALL NOT overwrite the original stored resource or resubmit generation

#### Scenario: Unused media cleanup overlaps upload or history

- **WHEN** automatic unused-media cleanup runs
- **THEN** media referenced by retained generation history and in-progress uploads SHALL remain protected
- **AND** explicitly deleted unreferenced resources SHALL release all tracked temporary URL versions

#### Scenario: Multiple consumers share one stored media resource

- **WHEN** multiple consumers concurrently resolve the same resource version
- **THEN** the system SHALL deduplicate its pending load and track active use
- **AND** temporary URLs SHALL be revoked only after the last active consumer releases that version

#### Scenario: Resource is replaced or view is closed

- **WHEN** a resource version is replaced or its view is closed
- **THEN** obsolete temporary URLs, independent React roots and media resources SHALL be released through an idempotent cleanup path
- **AND** stale asynchronous responses SHALL NOT recreate released resources

#### Scenario: Cache budget is exceeded during video-only use

- **WHEN** a video cache insertion or restoration exceeds its approved cold-resource budget
- **THEN** eviction SHALL occur without depending on a future image request
- **AND** the system SHALL retain persistent media and preserve valid active Range responses

### Requirement: Verify Startup And Memory Improvements With Reproducible Evidence

Performance acceptance SHALL use comparable production-build workloads and report startup responsiveness, retained application resources and available browser memory measurements separately. JS heap usage SHALL NOT be represented as total browser memory.

#### Scenario: Code tests pass without browser profiling

- **WHEN** only unit, component, type or build checks have been executed
- **THEN** the result SHALL explicitly state that browser memory and startup improvements remain unverified

#### Scenario: Repeated open and close workload

- **WHEN** the approved profiling workload repeatedly opens, closes and switches media views
- **THEN** validation SHALL check retained-resource counts and retaining paths for growth after warmup
- **AND** unavailable browser metrics SHALL be reported as unavailable rather than zero
