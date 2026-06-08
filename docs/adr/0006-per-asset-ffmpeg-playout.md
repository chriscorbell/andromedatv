# Per-asset ffmpeg playout

AndromedaTV will initially run one ffmpeg process per Media Asset to produce the Live HLS Output, transcoding every source into a Uniform HLS Profile. This makes Playout Completion, failure handling, restart recovery, and cursor advancement easier to reason about than a single long-lived concat pipeline, and it keeps browser playback predictable across mixed source codecs, accepting that small transitions between files may need later smoothing.
