## ADDED Requirements
### Requirement: Native ordinary-page scrolling
普通页面 MUST allow document scrolling with mouse wheel, keyboard, and touch gestures while the canvas workspace MAY retain its own bounded scroll regions.

#### Scenario: Scroll the home page
- **WHEN** a user scrolls below the first viewport on the home page
- **THEN** the document moves and the template, works, and workflow sections become reachable

#### Scenario: Scroll on a narrow viewport
- **WHEN** a user swipes vertically on a mobile viewport
- **THEN** the ordinary page scroll position increases without horizontal overflow

### Requirement: In-app ordinary-page navigation
首页、创作中心和音乐台之间 MUST use in-app history navigation without re-running the application bootstrap for each transition.

#### Scenario: Navigate between ordinary pages
- **WHEN** a user opens the music station or creative center from the home page
- **THEN** the URL and visible page update without displaying the application startup shell

#### Scenario: Browser back and forward
- **WHEN** a user uses browser back or forward between ordinary pages
- **THEN** the matching page is restored and its scroll position starts at the route boundary
