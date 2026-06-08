# Library reconciliation preserves rotation

AndromedaTV will apply Library changes without reshuffling existing Channel State. New Schedulable Series are appended after the active Rotation Cycle, removed or unschedulable Series are excluded from future selections, and new Episodes enter their Series' Chronological Episode Order without resetting the Series cursor unless the cursor points to missing media.
