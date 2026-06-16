import fs from "fs/promises";
import path from "path";
import { createApp } from "./app";
import { ensureInitialAdmin, loadOrCreateJwtSecret } from "./bootstrap";
import { initDb } from "./db";
import { createJellyfinYearProvider } from "./lib/jellyfin";

const PORT = Number(process.env.PORT || 3001);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "";
const ERSATZTV_BASE_URL = process.env.ERSATZTV_BASE_URL || "";
const JELLYFIN_BASE_URL = process.env.JELLYFIN_BASE_URL || "";
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY || "";
const PUBLIC_APP_ORIGIN = process.env.PUBLIC_APP_ORIGIN || "";
const STATUS_API_MODE = process.env.STATUS_API_MODE || "admin";
const TRUST_PROXY = process.env.TRUST_PROXY || "";
const MAX_STREAM_CLIENTS = process.env.MAX_STREAM_CLIENTS || "";
const MAX_STREAM_CLIENTS_PER_IP = process.env.MAX_STREAM_CLIENTS_PER_IP || "";
const DB_PATH =
    process.env.DB_PATH ||
    path.resolve(__dirname, "..", "data", "andromeda.db");
const JWT_SECRET_PATH =
    process.env.JWT_SECRET_PATH ||
    path.resolve(path.dirname(DB_PATH), "jwt-secret");
const STATIC_DIR = path.resolve(__dirname, "..", "..", "dist");
const INITIAL_ADMIN_NICKNAME = (process.env.INITIAL_ADMIN_NICKNAME || "").trim();
const INITIAL_ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD || "";

function normalizePublicAppOrigin(value: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    return new URL(trimmed).origin;
}

function parseStatusApiMode(value: string): "public" | "admin" | "disabled" {
    const normalized = value.trim().toLowerCase();
    if (normalized === "public" || normalized === "admin" || normalized === "disabled") {
        return normalized;
    }

    throw new Error('STATUS_API_MODE must be "public", "admin", or "disabled"');
}

function parsePositiveInt(value: string, fallback: number, name: string): number {
    const trimmed = value.trim();
    if (!trimmed) {
        return fallback;
    }

    const numeric = Number(trimmed);
    if (Number.isInteger(numeric) && numeric > 0) {
        return numeric;
    }

    throw new Error(`${name} must be a positive integer`);
}

function parseTrustProxy(value: string): boolean | number | string | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }
    if (trimmed === "true") {
        return true;
    }
    if (trimmed === "false") {
        return false;
    }

    const numeric = Number(trimmed);
    if (Number.isInteger(numeric) && String(numeric) === trimmed) {
        return numeric;
    }

    return trimmed;
}

async function main() {
    if (!ERSATZTV_BASE_URL) {
        throw new Error("ERSATZTV_BASE_URL is required");
    }

    if (Boolean(INITIAL_ADMIN_NICKNAME) !== Boolean(INITIAL_ADMIN_PASSWORD)) {
        throw new Error(
            "INITIAL_ADMIN_NICKNAME and INITIAL_ADMIN_PASSWORD must be set together"
        );
    }

    if (Boolean(JELLYFIN_BASE_URL) !== Boolean(JELLYFIN_API_KEY)) {
        throw new Error(
            "JELLYFIN_BASE_URL and JELLYFIN_API_KEY must be set together"
        );
    }

    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });

    const jwtSecret = await loadOrCreateJwtSecret(
        process.env.JWT_SECRET || "",
        JWT_SECRET_PATH
    );
    const db = await initDb(DB_PATH);
    await ensureInitialAdmin({
        db,
        nickname: INITIAL_ADMIN_NICKNAME,
        password: INITIAL_ADMIN_PASSWORD,
    });
    const publicAppOrigin = normalizePublicAppOrigin(PUBLIC_APP_ORIGIN);
    const statusApiMode = parseStatusApiMode(STATUS_API_MODE);
    const trustProxy = parseTrustProxy(TRUST_PROXY);
    const maxStreamClients = parsePositiveInt(
        MAX_STREAM_CLIENTS,
        1000,
        "MAX_STREAM_CLIENTS"
    );
    const maxStreamClientsPerIp = parsePositiveInt(
        MAX_STREAM_CLIENTS_PER_IP,
        20,
        "MAX_STREAM_CLIENTS_PER_IP"
    );
    const yearProvider =
        JELLYFIN_BASE_URL && JELLYFIN_API_KEY
            ? createJellyfinYearProvider({
                  baseUrl: new URL(JELLYFIN_BASE_URL),
                  apiKey: JELLYFIN_API_KEY,
              })
            : undefined;

    const app = createApp({
        corsOrigin: CORS_ORIGIN,
        db,
        ersatzBaseUrl: new URL(ERSATZTV_BASE_URL),
        jwtSecret,
        publicAppOrigin,
        yearProvider,
        maxStreamClients,
        maxStreamClientsPerIp,
        statusApiMode,
        staticDir: STATIC_DIR,
        trustProxy,
    });

    const server = app.listen(PORT, () => {
        console.log(`andromeda app listening on ${PORT}`);
    });

    // Bound how long a client may take to send a full request (slowloris), while
    // leaving the socket-inactivity timeout off so long-lived SSE chat streams
    // are not killed (their request completes immediately; only the response is
    // held open, and the SSE handlers also opt their sockets out explicitly).
    // headersTimeout stays just above keepAliveTimeout to avoid the proxy/LB
    // keep-alive race, and requestTimeout sits above headersTimeout.
    server.requestTimeout = 120_000;
    server.timeout = 0;
    server.keepAliveTimeout = 75_000;
    server.headersTimeout = 90_000;
}

main().catch((err) => {
    console.error("Failed to start server", err);
    process.exit(1);
});
