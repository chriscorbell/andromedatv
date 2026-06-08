# Single-container deployment

AndromedaTV will remain a Single-container Deployment for v1: the web app, API, scheduler, metadata cache, and Playout Engine will ship in one deployable container. The backend should still keep scanner, metadata, scheduler, playout, and HLS serving code separated internally so the architecture can evolve without adding multi-container orchestration before it is needed.
