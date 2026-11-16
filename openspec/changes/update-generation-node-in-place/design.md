# Approved option B

Reuse generation-anchor and workzone rendering, task synchronization and result insertion. Do not change an element's type under the same ID: Plait caches renderer instances by ID.

`generationOrigin: { version: 1, draft: GenerationNodeElement }` is optional canvas metadata on progress and output elements. It is an immutable submission snapshot, separate from editable `generationNode`. Store live-source media at submission time. Each independent batch slot restores count 1.

Create progress with existing transforms, then consume the draft and adopt those progress elements in a single native history batch. Terminal removal of adopted progress must also participate in history. Restoring editing is a local canvas operation; task retries remain in the existing queue. Undo, redo, copying and loading never initiate network generation.

Result insertion inherits the snapshot by task identity, falling back to generationNodeId, from the live progress element through the generation plugin. Copying progress converts it back to a draft; copied results remap or detach reference source IDs. Existing recursive embedded-media backup includes nested references and masks. No task wire protocol or server migration is added.

First slot stays at the draft origin. Subsequent slots reserve the existing maximum image envelope and avoid other canvas objects. Video result insertion reads the current WorkZone position for adopted drafts. Existing board/task guards remain authoritative.

Explicit draft input lines are rebuilt as progress associations inside the replacement history batch, including video inputs that do not enter the image-only association preparation path. Historical model restoration lazily loads only the saved provider catalog and rejects disabled/missing providers rather than substituting another provider.
