# Wall-clock resume

AndromedaTV will prefer Wall-clock Resume after restart, computing the live channel position from Channel State, elapsed real time, and known media durations. Boundary Resume remains the fallback when durations are missing or the playout engine cannot seek safely, but the primary channel experience should behave like a continuous broadcast rather than rewinding to the last confirmed Media Asset boundary.
