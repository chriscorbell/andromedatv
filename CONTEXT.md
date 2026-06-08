# AndromedaTV Context

AndromedaTV exists to run one programmed 24/7 anime channel from local media files.

## Language

**Single-channel playout server**:
AndromedaTV owns the media-library, metadata, schedule, and live stream behavior needed to run one programmed channel from local files.
_Avoid_: General-purpose media server, Jellyfin replacement

**Single-container Deployment**:
The production shape where the web app, API, scheduler, metadata cache, and Playout Engine run in one deployable container.

**Library**:
The configured local file tree that AndromedaTV scans for Media Assets.

**Andromeda Library**:
The current production media Library rooted at `/nas/media/andromeda`, with Series under `series/` and Bump Assets under `bumps/`.

**Series Allowlist**:
A temporary configuration that limits which Series from the Andromeda Library enter the Vertical Slice.

**Conventional Library Layout**:
A Library organization that separates Series files from Bump files on disk.
_Avoid_: Arbitrary library inference

**Media Asset**:
One playable local file plus its discovered facts and intended role in the channel.

**Episode Asset**:
A Media Asset that belongs to an anime series and may resolve to AniDB episode metadata.

**Bump Asset**:
A short Media Asset used between episodes. It is not part of AniDB episode ordering.

**Series**:
The anime work or grouping that an Episode Asset belongs to.

**Schedulable Series**:
A Series with at least one playable Episode Asset that has a trusted position in Chronological Episode Order.

**Episode**:
The metadata identity of an Episode Asset, separate from the local file that contains the playable media.

**Chronological Episode Order**:
The trusted order of Episode Assets within a Series. Sidecar Overrides define it first, AniDB defines it by default, and filename season/episode order is a fallback.

**Sidecar Override**:
Local metadata placed near a Media Asset to correct or provide facts that cannot be inferred reliably from the Conventional Library Layout or external metadata.

**Metadata Authority**:
The source whose facts AndromedaTV trusts when multiple sources describe the same Series, Episode, or Media Asset.

**AniDB Metadata Cache**:
The local store of AniDB Series and Episode facts used by AndromedaTV during Library scans and schedule generation.

**Metadata Refresh**:
A controlled update of AniDB Metadata Cache entries when a Series is first added or when an operator requests it.

**Jellyfin Metadata Seed**:
A one-time, pre-run source of existing Series and Episode facts from the current Jellyfin library data. It is not a runtime metadata authority.

**Unresolved Episode Asset**:
An Episode Asset that remains playable but does not yet have a trusted Episode identity.

**Series Rotation**:
The randomized order of Series used by the channel's episode schedule.

**Episode Cursor**:
The current Episode position for a Series in the channel schedule.

**Bump Rotation**:
The filename-sorted list of Bump Assets used between Episodes.

**Bump Cursor**:
The current Bump Asset position in the Bump Rotation.

**Playout Queue**:
The endless ordered sequence of Episode Assets and Bump Assets that AndromedaTV plays.
_Avoid_: Wall-clock programming grid

**Round-robin Series Queue**:
A Playout Queue that advances one Episode per Series Rotation slot, then returns to the first Series and advances each Series' Episode Cursor.

**Round-robin Bump Queue**:
A Playout Queue behavior that advances one Bump Asset after each Episode and wraps to the first Bump Asset after the last Bump Asset plays.

**Channel State**:
The persistent identity and progress of the channel, including Series Rotation, Episode Cursors, and current Playout Queue position.

**Rotation Cycle**:
One complete pass through the current Series Rotation.

**Library Reconciliation**:
The process of applying Library changes to Channel State without reshuffling the existing Series Rotation.

**Playout Completion**:
The confirmed end of a Media Asset during playback. Schedule prediction alone is not Playout Completion.

**Playout Engine**:
The backend component that turns the Playout Queue into the live stream.

**Live HLS Output**:
The HLS playlist and segments produced by the Playout Engine for viewers.

**Compatibility Route**:
An existing public URL preserved while its implementation moves from external proxying to internal AndromedaTV behavior.

**Vertical Slice**:
A small end-to-end implementation that proves AndromedaTV can scan, schedule, and stream from local Media Assets without external playout services.

**Playback Acceptance**:
The requirement that a Vertical Slice proves real playback through the existing AndromedaTV web UI, not only backend behavior.

**Uniform HLS Profile**:
The browser-safe video and audio format that every Media Asset is transcoded into for Live HLS Output.

**Hardware Transcoding**:
Using the production server's Intel Arc GPU to produce the Uniform HLS Profile.

**Transcode Acceleration Mode**:
The deployment setting that controls whether Hardware Transcoding is required, preferred, or disabled.

**Wall-clock Resume**:
Restart recovery that computes the live channel position from elapsed real time and known media durations.

**Boundary Resume**:
Restart recovery that starts from a known Media Asset boundary when Wall-clock Resume is unavailable.
