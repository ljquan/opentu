## ADDED Requirements

### Requirement: Managed generation uses durable server tasks

The AI input bar, Agent workflows, Skills, and direct media tools SHALL use the
server generation task contract in managed production while preserving their
existing user-facing creation behavior.

#### Scenario: Direct generation completes through the gateway

- **WHEN** a user submits text, image, video, or audio generation in managed
  production
- **THEN** the client SHALL create a server generation task
- **AND** SHALL map normalized task progress and results into the existing
  canvas or media insertion flow

#### Scenario: Workflow generates multiple dependent assets

- **WHEN** an Agent, Skill, PPT, or batch workflow creates dependent generation
  steps
- **THEN** each upstream-producing step SHALL reference a durable server task ID
- **AND** dependency retries SHALL reuse the original idempotency context

#### Scenario: User returns to an unfinished task

- **WHEN** the client restores an unfinished generation operation after reload
  or navigation
- **THEN** it SHALL fetch the server task by ID
- **AND** SHALL NOT reconstruct or replay a credential-bearing provider request

