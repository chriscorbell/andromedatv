# Randomized round-robin schedule

AndromedaTV will generate its core Playout Queue by randomizing Series order, choosing a random starting Episode Cursor for each Series, and then playing one Episode per Series in that Series Rotation before advancing each cursor. After an Episode plays, AndromedaTV inserts the next Bump Asset from the Bump Rotation; when a Series reaches its final Episode or the Bump Rotation reaches its final Bump Asset, the relevant cursor wraps back to the first item the next time it is selected.
