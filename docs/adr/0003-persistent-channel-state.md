# Persistent channel state

AndromedaTV will persist Channel State instead of recomputing the randomized Series Rotation and Episode Cursors on each startup. This preserves the channel's identity across container restarts and lets schedule prediction remain separate from Playout Completion, so cursors advance only when playback reaches confirmed media boundaries.
