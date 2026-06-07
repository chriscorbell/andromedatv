Status: done

## What to build

Advance Channel State only after confirmed Playout Completion, inserting the next Bump Asset from Bump Rotation between Episodes and keeping schedule prediction aligned with the Media Asset that the Playout Engine is actually producing.

## Acceptance criteria

- [x] Successful episode Playout Completion advances to the next Bump Asset rather than directly to another Episode.
- [x] Successful bump Playout Completion advances to the next Series Rotation slot and that Series' next Episode Cursor.
- [x] Series cursors wrap to the first Episode after the final Episode plays.
- [x] The Bump Cursor wraps to the first Bump Asset after the final Bump Asset plays.
- [x] `/api/schedule` updates to reflect the advanced Playout Queue.
- [x] Cursor advancement is not triggered by schedule prediction alone.

## Blocked by

- `.scratch/ersatztv-removal/issues/03-produce-cpu-live-hls-output-for-current-media-asset.md`
