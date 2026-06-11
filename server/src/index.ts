import fs from "fs/promises";
import path from "path";
import { createApp } from "./app";
import { ensureInitialAdmin, loadOrCreateJwtSecret } from "./bootstrap";
import { initDb } from "./db";
import {
    parseTranscodeAccelerationMode,
    validateTranscodeAcceleration,
} from "./lib/transcode-acceleration";

const PORT = Number(process.env.PORT || 3001);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const ERSATZTV_BASE_URL = process.env.ERSATZTV_BASE_URL || "";
const PUBLIC_APP_ORIGIN = process.env.PUBLIC_APP_ORIGIN || "";
const STATUS_API_MODE = process.env.STATUS_API_MODE || "admin";
const TRUST_PROXY = process.env.TRUST_PROXY || "";
const PLAYOUT_MODE = process.env.PLAYOUT_MODE || "internal";
const ANDROMEDA_SERIES_ROOT =
    process.env.ANDROMEDA_SERIES_ROOT || "/nas/media/andromeda/series";
const ANDROMEDA_BUMPS_ROOT =
    process.env.ANDROMEDA_BUMPS_ROOT || "/nas/media/andromeda/bumps";
const ANDROMEDA_SERIES_ALLOWLIST = process.env.ANDROMEDA_SERIES_ALLOWLIST || "";
const ANDROMEDA_LIBRARY_REFRESH_MS = Math.max(
    30_000,
    Number(process.env.ANDROMEDA_LIBRARY_REFRESH_MS) || 5 * 60_000
);
const DB_PATH =
    process.env.DB_PATH ||
    path.resolve(__dirname, "..", "data", "andromeda.db");
const INTERNAL_HLS_OUTPUT_ROOT =
    process.env.INTERNAL_HLS_OUTPUT_ROOT ||
    path.resolve(path.dirname(DB_PATH), "hls");
const TRANSCODE_ACCEL = process.env.TRANSCODE_ACCEL || "";
const TRANSCODE_ACCEL_DEVICE =
    process.env.TRANSCODE_ACCEL_DEVICE || "/dev/dri/renderD128";
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

function parsePlayoutMode(value: string): "ersatztv" | "internal" {
    const normalized = value.trim().toLowerCase();
    if (normalized === "ersatztv" || normalized === "internal") {
        return normalized;
    }

    throw new Error('PLAYOUT_MODE must be "ersatztv" or "internal"');
}

function parseSeriesAllowlist(value: string): string[] {
    return value
        .split(",")
        .map((seriesTitle) => seriesTitle.trim())
        .filter(Boolean);
}

async function main() {
    const playoutMode = parsePlayoutMode(PLAYOUT_MODE);
    if (playoutMode === "ersatztv" && !ERSATZTV_BASE_URL) {
        throw new Error("ERSATZTV_BASE_URL is required");
    }

    if (Boolean(INITIAL_ADMIN_NICKNAME) !== Boolean(INITIAL_ADMIN_PASSWORD)) {
        throw new Error(
            "INITIAL_ADMIN_NICKNAME and INITIAL_ADMIN_PASSWORD must be set together"
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
    const ersatzBaseUrl = new URL(ERSATZTV_BASE_URL || "http://127.0.0.1:8409");
    const transcodeAcceleration = playoutMode === "internal"
        ? await validateTranscodeAcceleration({
            devicePath: TRANSCODE_ACCEL_DEVICE,
            mode: parseTranscodeAccelerationMode(TRANSCODE_ACCEL),
        })
        : undefined;
    const internalScheduleOptions = playoutMode === "internal"
        ? {
            bumpsRoot: ANDROMEDA_BUMPS_ROOT,
            seriesAllowlist: parseSeriesAllowlist(ANDROMEDA_SERIES_ALLOWLIST),
            seriesRoot: ANDROMEDA_SERIES_ROOT,
        }
        : undefined;

    const app = createApp({
        corsOrigin: CORS_ORIGIN,
        db,
        ersatzBaseUrl,
        jwtSecret,
        internalPlayout: internalScheduleOptions
            ? {
                ...internalScheduleOptions,
                hlsOutputRoot: INTERNAL_HLS_OUTPUT_ROOT,
                transcodeAcceleration,
            }
            : undefined,
        internalSchedule: internalScheduleOptions,
        publicAppOrigin,
        statusApiMode,
        staticDir: STATIC_DIR,
        trustProxy,
    });

    const server = app.listen(PORT, () => {
        console.log(`andromeda app listening on ${PORT}`);
    });

    if (internalScheduleOptions) {
        // Populate the library inventory and start the always-on broadcast
        // service in the background. Clients tune into that running HLS output.
        void app.locals.startInternalPlayout();
        app.locals.startLibraryRefreshLoop(ANDROMEDA_LIBRARY_REFRESH_MS);
    }

    server.requestTimeout = 0;
    server.timeout = 0;
    server.keepAliveTimeout = 75_000;
    server.headersTimeout = 90_000;
}

main().catch((err) => {
    console.error("Failed to start server", err);
    process.exit(1);
});
