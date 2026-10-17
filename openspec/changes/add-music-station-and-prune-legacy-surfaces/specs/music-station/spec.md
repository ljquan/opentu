## ADDED Requirements

### Requirement: Standalone music station

The application SHALL provide a standalone `/music-station` page for creating,
listening to, organizing, and publishing generated music.

#### Scenario: Open the music station

- **WHEN** a user opens `/music-station`
- **THEN** the page SHALL show the creation entry, current track area, library
  state, and station navigation without requiring a canvas board

#### Scenario: Use the station on a narrow viewport

- **WHEN** the viewport is narrower than the desktop breakpoint
- **THEN** the station SHALL reflow its creation, player, lyrics, and library
  areas without horizontal overflow or overlapping controls

### Requirement: Platform-managed music generation

The station SHALL submit music and lyrics requests through the existing audio
task queue and platform model routing without asking regular users to configure
an API key.

#### Scenario: Generate a track

- **WHEN** a user submits a valid music brief
- **THEN** the station SHALL create an `AUDIO` task with the selected
  platform-provided model and show its progress

#### Scenario: Audio task completes

- **WHEN** the audio task completes with cached URLs and metadata
- **THEN** the station SHALL project the result as a playable track with its
  title, cover, lyrics, duration, and provider identity when available

#### Scenario: Audio task fails

- **WHEN** the platform cannot complete the audio task
- **THEN** the station SHALL show the task error and provide retry without
  exposing provider credentials

### Requirement: Local release lifecycle

The station SHALL persist track metadata locally and support draft, public, and
private visibility states through a replaceable repository boundary.

#### Scenario: Save a draft

- **WHEN** a generated track is saved from the station
- **THEN** its audio, cover, lyrics, prompt, and model metadata SHALL be stored
  in the local release repository as a draft

#### Scenario: Publish or privatize a track

- **WHEN** a user changes a saved track's visibility
- **THEN** the repository SHALL persist the selected public or private state
  and the station SHALL reflect that state in the library

### Requirement: Legacy surface pruning

The application SHALL remove obsolete product entry points while retaining
underlying modules required for existing canvas and local-data compatibility.

#### Scenario: Open the product root

- **WHEN** the React application mounts at `/`
- **THEN** the user SHALL see the React product home directly without a legacy
  SEO or startup fallback page beneath it

#### Scenario: Open a canvas after a non-board route

- **WHEN** a user visits `/` or `/music-station` and then opens a board URL
- **THEN** the application SHALL not show a false crash-recovery prompt solely
  because the previous route did not initialize a board
