import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import http from "http";
import https from "https";
import { initDb } from "./db";

const PORT = Number(process.env.PORT || 3001);
let jwtSecret = process.env.JWT_SECRET || "";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const ERSATZTV_BASE_URL = process.env.ERSATZTV_BASE_URL || "";
const DB_PATH =
    process.env.DB_PATH ||
    path.resolve(__dirname, "..", "data", "chat.db");
const JWT_SECRET_PATH =
    process.env.JWT_SECRET_PATH ||
    path.resolve(path.dirname(DB_PATH), "jwt-secret");
const STATIC_DIR = path.resolve(__dirname, "..", "..", "dist");
const STREAM_AUTH_COOKIE_NAME = "andromeda_stream";
const AUTH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INITIAL_ADMIN_NICKNAME = (process.env.INITIAL_ADMIN_NICKNAME || "").trim();
const INITIAL_ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD || "";

if (!ERSATZTV_BASE_URL) {
    console.error("ERSATZTV_BASE_URL is required");
    process.exit(1);
}

type AuthedRequest = Request & {
    user?: {
        nickname: string;
        isAdmin: boolean;
    };
};
type PublicStreamClient = {
    res: Response;
};
type PrivateStreamClient = {
    nickname: string;
    res: Response;
};
type AuthTokenPayload = {
    nickname?: string;
};
type MessageRow = {
    id: number;
    nickname: string;
    body: string;
    created_at: string;
    is_admin: boolean;
};
type MessageDbRow = Omit<MessageRow, "is_admin"> & {
    is_admin: number;
};

const publicStreamClients = new Set<PublicStreamClient>();
const privateStreamClients = new Set<PrivateStreamClient>();
let heartbeatTimer: NodeJS.Timeout | null = null;
const rateLimits = new Map<
    string,
    { timestamps: number[]; cooldownUntil?: number }
>();

const RATE_LIMIT_MAX = 5;
const RATE_WINDOW_MS = 10_000;
const COOLDOWN_MS = 60_000;

const HOP_BY_HOP_HEADERS = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
]);

function getNicknameValidationError(value: string): string | null {
    if (value.length < 3) {
        return "Username must be at least 3 characters.";
    }
    if (value.length > 24) {
        return "Username must be 24 characters or fewer.";
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
        return "Username can only use letters, numbers, underscores, and hyphens.";
    }
    return null;
}

function validateNickname(value: string): boolean {
    return getNicknameValidationError(value) === null;
}

function normalizeNickname(value: string): string {
    return value.trim().toLowerCase();
}

function getPasswordValidationError(value: string): string | null {
    if (value.length < 6) {
        return "Password must be at least 6 characters.";
    }
    if (value.length > 72) {
        return "Password must be 72 characters or fewer.";
    }
    return null;
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
    if (!header) {
        return {};
    }

    return header.split(";").reduce<Record<string, string>>((cookies, part) => {
        const [rawName, ...rawValue] = part.trim().split("=");
        if (!rawName || rawValue.length === 0) {
            return cookies;
        }

        cookies[rawName] = decodeURIComponent(rawValue.join("="));
        return cookies;
    }, {});
}

function validateMessage(value: string): boolean {
    return value.length >= 1 && value.length <= 500;
}

function containsUrl(value: string): boolean {
    return /(https?:\/\/|www\.)\S+/i.test(value) ||
        /\b([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?/i.test(value);
}

function checkRateLimit(nickname: string, now: number) {
    const entry = rateLimits.get(nickname) || { timestamps: [] };
    const recent = entry.timestamps.filter(
        (timestamp) => now - timestamp < RATE_WINDOW_MS
    );

    if (entry.cooldownUntil && now < entry.cooldownUntil) {
        rateLimits.set(nickname, { ...entry, timestamps: recent });
        const remainingMs = entry.cooldownUntil - now;
        return {
            allowed: false,
            cooldownSeconds: Math.ceil(remainingMs / 1000),
        };
    }

    if (recent.length >= RATE_LIMIT_MAX) {
        const cooldownUntil = now + COOLDOWN_MS;
        rateLimits.set(nickname, { timestamps: recent, cooldownUntil });
        return {
            allowed: false,
            cooldownSeconds: Math.ceil(COOLDOWN_MS / 1000),
        };
    }

    recent.push(now);
    rateLimits.set(nickname, { timestamps: recent });
    return { allowed: true };
}

function extractBearerToken(req: Request): string | null {
    const header = req.header("authorization") || "";
    const match = header.match(/^Bearer (.+)$/);
    return match ? match[1] : null;
}

function getCookieToken(req: Request): string | null {
    const cookies = parseCookieHeader(req.header("cookie"));
    return cookies[STREAM_AUTH_COOKIE_NAME] || null;
}

function verifyToken(token: string): AuthTokenPayload | null {
    try {
        const payload = jwt.verify(token, jwtSecret) as AuthTokenPayload;
        return payload.nickname ? payload : null;
    } catch {
        return null;
    }
}

function issueAuthToken(nickname: string): string {
    return jwt.sign({ nickname }, jwtSecret, { expiresIn: "7d" });
}

function isSecureRequest(req: Request): boolean {
    const forwardedProto = req.header("x-forwarded-proto");
    if (forwardedProto) {
        return forwardedProto.split(",")[0]?.trim() === "https";
    }

    return req.secure;
}

function setStreamAuthCookie(req: Request, res: Response, token: string) {
    res.cookie(STREAM_AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: isSecureRequest(req),
        path: "/chat",
        maxAge: AUTH_TOKEN_TTL_MS,
    });
}

function clearStreamAuthCookie(req: Request, res: Response) {
    res.clearCookie(STREAM_AUTH_COOKIE_NAME, {
        httpOnly: true,
        sameSite: "lax",
        secure: isSecureRequest(req),
        path: "/chat",
    });
}

function writeSseEvent(res: Response, event: string, data: unknown) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function normalizeIptvBasePath(pathname: string): string {
    const trimmed = pathname.replace(/\/+$/, "");
    if (!trimmed || trimmed === "/") {
        return "/iptv";
    }
    if (trimmed.endsWith("/iptv")) {
        return trimmed;
    }
    return `${trimmed}/iptv`;
}

function joinUrlPaths(basePath: string, suffixPath: string): string {
    const normalizedBase = basePath.endsWith("/")
        ? basePath.slice(0, -1)
        : basePath;
    const normalizedSuffix = suffixPath.startsWith("/")
        ? suffixPath
        : `/${suffixPath}`;
    const joined = `${normalizedBase}${normalizedSuffix}`;
    return joined.replace(/\/\/{2,}/g, "/");
}

function getRequestOrigin(req: Request): string {
    const protoHeader = req.header("x-forwarded-proto") || req.protocol;
    const hostHeader = req.header("x-forwarded-host") || req.header("host") || "";
    const proto = protoHeader.split(",")[0]?.trim() || "http";
    const host = hostHeader.split(",")[0]?.trim();
    if (!host) {
        return "";
    }
    return `${proto}://${host}`;
}

function isPlaylistResponse(contentType: string | undefined, pathname: string): boolean {
    const type = (contentType || "").toLowerCase();
    if (pathname.toLowerCase().endsWith(".m3u8")) {
        return true;
    }
    return (
        type.includes("application/vnd.apple.mpegurl") ||
        type.includes("application/x-mpegurl") ||
        type.includes("audio/mpegurl") ||
        type.includes("text/plain")
    );
}

function rewritePlaylistBody(content: string, publicOrigin: string): string {
    if (!publicOrigin) {
        return content;
    }
    return content.replace(/https?:\/\/[^\s"'#]+\/iptv\//g, `${publicOrigin}/iptv/`);
}

function setNoCacheHeaders(res: Response) {
    res.setHeader("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("pragma", "no-cache");
    res.setHeader("expires", "0");
    res.setHeader("surrogate-control", "no-store");
}

function copyUpstreamHeaders(
    upstreamHeaders: http.IncomingHttpHeaders,
    res: Response,
    skipContentLength = false
) {
    for (const [header, rawValue] of Object.entries(upstreamHeaders)) {
        if (!rawValue) {
            continue;
        }
        const headerName = header.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(headerName)) {
            continue;
        }
        if (skipContentLength && headerName === "content-length") {
            continue;
        }
        if (skipContentLength && headerName === "content-encoding") {
            continue;
        }
        res.setHeader(header, rawValue);
    }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

function broadcastChatEvent(event: string, data: unknown) {
    for (const client of publicStreamClients) {
        writeSseEvent(client.res, event, data);
    }
    for (const client of privateStreamClients) {
        writeSseEvent(client.res, event, data);
    }
}

function broadcastPrivateEvent(
    event: string,
    data: unknown,
    matcher: (client: PrivateStreamClient) => boolean = () => true
) {
    for (const client of privateStreamClients) {
        if (matcher(client)) {
            writeSseEvent(client.res, event, data);
        }
    }
}

function startHeartbeat() {
    if (heartbeatTimer) {
        return;
    }

    heartbeatTimer = setInterval(() => {
        for (const client of publicStreamClients) {
            client.res.write(": heartbeat\n\n");
        }
        for (const client of privateStreamClients) {
            client.res.write(": heartbeat\n\n");
        }
    }, 25000);
}

async function main() {
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });

    const loadJwtSecret = async (): Promise<string> => {
        if (jwtSecret) {
            return jwtSecret;
        }

        try {
            const persistedSecret = (await fs.readFile(JWT_SECRET_PATH, "utf8")).trim();
            if (persistedSecret) {
                console.log(`Loaded JWT secret from ${JWT_SECRET_PATH}`);
                return persistedSecret;
            }
        } catch (error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code !== "ENOENT") {
                throw error;
            }
        }

        const generatedSecret = crypto.randomBytes(48).toString("hex");
        await fs.writeFile(JWT_SECRET_PATH, generatedSecret, {
            encoding: "utf8",
            mode: 0o600,
        });
        console.log(`Generated JWT secret at ${JWT_SECRET_PATH}`);
        return generatedSecret;
    };

    jwtSecret = await loadJwtSecret();
    const db = await initDb(DB_PATH);
    const ersatzBaseUrl = new URL(ERSATZTV_BASE_URL);
    const ersatzIptvBasePath = normalizeIptvBasePath(ersatzBaseUrl.pathname);

    if (Boolean(INITIAL_ADMIN_NICKNAME) !== Boolean(INITIAL_ADMIN_PASSWORD)) {
        throw new Error(
            "INITIAL_ADMIN_NICKNAME and INITIAL_ADMIN_PASSWORD must be set together"
        );
    }

    const findUserByNickname = async (nickname: string) =>
        db.get<{
            nickname: string;
            banned: number;
            is_admin: number;
        }>(
            "SELECT nickname, banned, is_admin FROM users WHERE nickname = ? COLLATE NOCASE",
            nickname
        );

    const listMessages = async (): Promise<MessageRow[]> => {
        const rows = await db.all<Array<MessageDbRow>>(
            "SELECT messages.id, messages.nickname, messages.body, messages.created_at, " +
            "COALESCE(users.is_admin, 0) AS is_admin " +
            "FROM messages " +
            "LEFT JOIN users ON users.nickname = messages.nickname COLLATE NOCASE " +
            "ORDER BY messages.id DESC LIMIT 100"
        );

        return rows.map((row) => ({
            ...row,
            is_admin: row.is_admin === 1,
        }));
    };

    const ensureInitialAdmin = async () => {
        const adminCount = await db.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM users WHERE is_admin = 1"
        );
        if ((adminCount?.count || 0) > 0) {
            return;
        }

        if (!INITIAL_ADMIN_NICKNAME || !INITIAL_ADMIN_PASSWORD) {
            console.warn(
                "No admin user configured. Set INITIAL_ADMIN_NICKNAME and INITIAL_ADMIN_PASSWORD to bootstrap one."
            );
            return;
        }

        const nicknameError = getNicknameValidationError(INITIAL_ADMIN_NICKNAME);
        if (nicknameError) {
            throw new Error(`INITIAL_ADMIN_NICKNAME is invalid: ${nicknameError}`);
        }

        const passwordError = getPasswordValidationError(INITIAL_ADMIN_PASSWORD);
        if (passwordError) {
            throw new Error(`INITIAL_ADMIN_PASSWORD is invalid: ${passwordError}`);
        }

        const nickname = normalizeNickname(INITIAL_ADMIN_NICKNAME);
        const passwordHash = await bcrypt.hash(INITIAL_ADMIN_PASSWORD, 10);
        const createdAt = new Date().toISOString();
        const existingUser = await db.get<{ id: number }>(
            "SELECT id FROM users WHERE nickname = ? COLLATE NOCASE",
            nickname
        );

        if (existingUser) {
            await db.run(
                "UPDATE users SET password_hash = ?, banned = 0, is_admin = 1 WHERE id = ?",
                passwordHash,
                existingUser.id
            );
        } else {
            await db.run(
                "INSERT INTO users (nickname, password_hash, created_at, banned, is_admin) VALUES (?, ?, ?, 0, 1)",
                nickname,
                passwordHash,
                createdAt
            );
        }

        console.log(`Bootstrapped admin user ${nickname}`);
    };

    await ensureInitialAdmin();

    const requireAuth = async (req: AuthedRequest, res: Response, next: NextFunction) => {
        const bearerToken = extractBearerToken(req);
        const cookieToken = getCookieToken(req);
        const authToken = bearerToken || cookieToken;
        if (!authToken) {
            clearStreamAuthCookie(req, res);
            return res.status(401).json({ error: "Missing auth token" });
        }

        const payload = verifyToken(authToken);
        if (!payload?.nickname) {
            clearStreamAuthCookie(req, res);
            return res.status(401).json({ error: "Invalid token" });
        }

        const user = await findUserByNickname(normalizeNickname(payload.nickname));
        if (!user) {
            clearStreamAuthCookie(req, res);
            return res.status(401).json({ error: "Invalid token" });
        }
        if (user.banned) {
            clearStreamAuthCookie(req, res);
            return res.status(403).json({ error: "this account has been banned" });
        }

        req.user = {
            nickname: normalizeNickname(user.nickname),
            isAdmin: user.is_admin === 1,
        };

        if (bearerToken) {
            setStreamAuthCookie(req, res, bearerToken);
        }

        return next();
    };

    const requireAdmin = (req: AuthedRequest, res: Response, next: NextFunction) => {
        if (!req.user?.isAdmin) {
            return res.status(403).json({ error: "Admin access required" });
        }

        return next();
    };

    const app = express();
    const chatRouter = express.Router();

    app.set("trust proxy", true);

    app.get("/health", (_req: Request, res: Response) => {
        res.json({ ok: true });
    });

    app.use(
        "/iptv",
        async (req: Request, res: Response) => {
            const requestUrl = new URL(req.originalUrl, "http://localhost");
            const suffixPath = requestUrl.pathname.replace(/^\/iptv(?=\/|$)/, "") || "/";

            const targetUrl = new URL(ersatzBaseUrl.toString());
            targetUrl.pathname = joinUrlPaths(ersatzIptvBasePath, suffixPath);
            targetUrl.search = requestUrl.search;

            const proxiedHeaders: Record<string, string> = {};
            for (const header of Object.keys(req.headers)) {
                const value = req.headers[header];
                if (!value) {
                    continue;
                }
                const headerName = header.toLowerCase();
                if (HOP_BY_HOP_HEADERS.has(headerName) || headerName === "host") {
                    continue;
                }
                proxiedHeaders[header] = Array.isArray(value)
                    ? value.join(",")
                    : String(value);
            }

            proxiedHeaders.host = targetUrl.host;
            proxiedHeaders["accept-encoding"] = "identity";
            proxiedHeaders["x-forwarded-proto"] = req.protocol;
            if (req.header("host")) {
                proxiedHeaders["x-forwarded-host"] = req.header("host") as string;
            }

            const transport = targetUrl.protocol === "https:" ? https : http;
            const hasBody = !(req.method === "GET" || req.method === "HEAD");

            const proxyReq = transport.request(
                targetUrl,
                {
                    method: req.method,
                    headers: proxiedHeaders,
                    timeout: 60_000,
                },
                async (proxyRes) => {
                    const contentType = String(proxyRes.headers["content-type"] || "");
                    const shouldRewrite = isPlaylistResponse(contentType, targetUrl.pathname);

                    if (shouldRewrite) {
                        try {
                            const original = await streamToBuffer(proxyRes);
                            const rewritten = rewritePlaylistBody(
                                original.toString("utf8"),
                                getRequestOrigin(req)
                            );
                            res.status(proxyRes.statusCode || 502);
                            copyUpstreamHeaders(proxyRes.headers, res, true);
                            setNoCacheHeaders(res);
                            res.setHeader("content-length", Buffer.byteLength(rewritten, "utf8"));
                            res.send(rewritten);
                        } catch {
                            if (!res.headersSent) {
                                res.status(502).json({ error: "failed to read upstream response" });
                            }
                        }
                        return;
                    }

                    res.status(proxyRes.statusCode || 502);
                    copyUpstreamHeaders(proxyRes.headers, res);
                    proxyRes.pipe(res);
                }
            );

            proxyReq.on("timeout", () => {
                proxyReq.destroy(new Error("upstream timeout"));
            });

            proxyReq.on("error", (err) => {
                if (!res.headersSent) {
                    res.status(502).json({
                        error: "iptv upstream request failed",
                        detail: err.message,
                    });
                }
            });

            if (hasBody) {
                req.pipe(proxyReq);
            } else {
                proxyReq.end();
            }
        }
    );

    chatRouter.use(
        cors({
            origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN,
            credentials: true,
        })
    );
    chatRouter.use(express.json({ limit: "8kb" }));

    chatRouter.get("/health", (_req: Request, res: Response) => {
        res.json({ ok: true });
    });

    chatRouter.post("/auth/register", async (req: Request, res: Response) => {
        const rawNickname = String(req.body?.nickname || "").trim();
        const nickname = normalizeNickname(rawNickname);
        const password = String(req.body?.password || "");
        const nicknameError = getNicknameValidationError(rawNickname);
        const passwordError = getPasswordValidationError(password);

        if (nicknameError) {
            return res.status(400).json({ error: nicknameError });
        }
        if (passwordError) {
            return res.status(400).json({ error: passwordError });
        }

        const existingUser = await db.get<{ banned: number }>(
            "SELECT banned FROM users WHERE nickname = ? COLLATE NOCASE",
            nickname
        );
        if (existingUser?.banned) {
            return res.status(403).json({ error: "this account has been banned" });
        }
        if (existingUser) {
            return res.status(409).json({ error: "Username already exists" });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const createdAt = new Date().toISOString();

        try {
            await db.run(
                "INSERT INTO users (nickname, password_hash, created_at) VALUES (?, ?, ?)",
                nickname,
                passwordHash,
                createdAt
            );
        } catch (error: unknown) {
            if (
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                String(error.code) === "SQLITE_CONSTRAINT"
            ) {
                return res.status(409).json({ error: "Username already exists" });
            }
            return res.status(500).json({ error: "Failed to register" });
        }

        const token = issueAuthToken(nickname);
        setStreamAuthCookie(req, res, token);
        return res.status(201).json({ nickname, token, isAdmin: false });
    });

    chatRouter.post("/auth/login", async (req: Request, res: Response) => {
        const rawNickname = String(req.body?.nickname || "").trim();
        const nickname = normalizeNickname(rawNickname);
        const password = String(req.body?.password || "");
        const nicknameError = getNicknameValidationError(rawNickname);
        const passwordError = getPasswordValidationError(password);

        if (nicknameError) {
            return res.status(400).json({ error: nicknameError });
        }

        if (passwordError) {
            return res.status(400).json({ error: passwordError });
        }

        const user = await db.get<{
            nickname: string;
            password_hash: string;
            banned: number;
            is_admin: number;
        }>(
            "SELECT nickname, password_hash, banned, is_admin FROM users WHERE nickname = ? COLLATE NOCASE " +
            "ORDER BY CASE WHEN nickname = ? THEN 0 ELSE 1 END, id ASC LIMIT 1",
            nickname,
            nickname
        );

        if (!user) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        if (user.banned) {
            return res.status(403).json({ error: "this account has been banned" });
        }

        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const canonicalNickname = normalizeNickname(user.nickname);
        const isAdmin = user.is_admin === 1;
        const token = issueAuthToken(canonicalNickname);
        setStreamAuthCookie(req, res, token);
        return res.json({ nickname: canonicalNickname, token, isAdmin });
    });

    chatRouter.post("/auth/logout", (req: Request, res: Response) => {
        clearStreamAuthCookie(req, res);
        return res.json({ ok: true });
    });

    chatRouter.get("/messages", requireAuth, async (req: AuthedRequest, res: Response) => {
        const rows = await listMessages();
        const messages = rows.slice().reverse();

        return res.json({
            messages,
            user: {
                nickname: req.user?.nickname || "",
                isAdmin: Boolean(req.user?.isAdmin),
            },
        });
    });

    chatRouter.get("/messages/public", async (_req: Request, res: Response) => {
        const rows = await listMessages();
        const messages = rows.slice().reverse();

        return res.json({ messages });
    });

    chatRouter.get("/messages/stream", requireAuth, async (req: AuthedRequest, res: Response) => {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.socket?.setTimeout(0);
        res.flushHeaders();

        res.write("retry: 5000\n\n");
        writeSseEvent(res, "ready", { ok: true });

        const client: PrivateStreamClient = {
            nickname: req.user?.nickname || "",
            res,
        };
        privateStreamClients.add(client);
        startHeartbeat();

        req.on("close", () => {
            privateStreamClients.delete(client);
            if (publicStreamClients.size === 0 && privateStreamClients.size === 0 && heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }
        });

        return undefined;
    });

    chatRouter.get("/messages/public/stream", (_req: Request, res: Response) => {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.socket?.setTimeout(0);
        res.flushHeaders();

        res.write("retry: 5000\n\n");
        writeSseEvent(res, "ready", { ok: true });

        const client: PublicStreamClient = { res };
        publicStreamClients.add(client);
        startHeartbeat();

        _req.on("close", () => {
            publicStreamClients.delete(client);
            if (publicStreamClients.size === 0 && privateStreamClients.size === 0 && heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }
        });

        return undefined;
    });

    chatRouter.post("/messages", requireAuth, async (req: AuthedRequest, res: Response) => {
        const nickname = req.user?.nickname || "";
        const body = String(req.body?.body || "").trim();
        if (!validateMessage(body)) {
            return res.status(400).json({ error: "Invalid message" });
        }

        if (containsUrl(body)) {
            return res.status(400).json({ error: "Links are not allowed" });
        }

        const now = Date.now();
        const limit = checkRateLimit(nickname, now);
        if (!limit.allowed) {
            const cooldownSeconds = limit.cooldownSeconds || 0;
            return res.status(429).json({
                error: "slow down, don't spam!",
                cooldownSeconds,
                retryAt: new Date(now + cooldownSeconds * 1000).toISOString(),
            });
        }
        const createdAt = new Date().toISOString();

        const result = await db.run(
            "INSERT INTO messages (nickname, body, created_at) VALUES (?, ?, ?)",
            nickname,
            body,
            createdAt
        );

        await db.run(
            "DELETE FROM messages WHERE id NOT IN (" +
            "SELECT id FROM messages ORDER BY id DESC LIMIT 100" +
            ")"
        );

        const message = {
            id: result.lastID,
            nickname,
            body,
            created_at: createdAt,
            is_admin: Boolean(req.user?.isAdmin),
        };

        broadcastChatEvent("message", message);

        return res.status(201).json({ message });
    });

    chatRouter.post("/admin/clear", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
        await db.run("DELETE FROM messages");

        broadcastChatEvent("clear", { ok: true });

        return res.json({ ok: true });
    });

    chatRouter.post(
        "/admin/messages/:id/delete",
        requireAuth,
        requireAdmin,
        async (req: Request, res: Response) => {
            const messageId = Number(req.params.id);
            if (!Number.isFinite(messageId) || messageId <= 0) {
                return res.status(400).json({ error: "Invalid message id" });
            }

            const existing = await db.get("SELECT 1 FROM messages WHERE id = ?", messageId);
            if (!existing) {
                return res.status(404).json({ error: "Message not found" });
            }

            await db.run(
                "UPDATE messages SET body = ? WHERE id = ?",
                "message deleted",
                messageId
            );

            broadcastChatEvent("delete", { id: messageId });

            return res.json({ ok: true });
        }
    );

    chatRouter.post(
        "/admin/messages/:id/warn",
        requireAuth,
        requireAdmin,
        async (req: Request, res: Response) => {
            const messageId = Number(req.params.id);
            if (!Number.isFinite(messageId) || messageId <= 0) {
                return res.status(400).json({ error: "Invalid message id" });
            }

            const message = await db.get<{ nickname: string }>(
                "SELECT nickname FROM messages WHERE id = ?",
                messageId
            );
            if (!message?.nickname) {
                return res.status(404).json({ error: "Message not found" });
            }

            await db.run(
                "UPDATE messages SET body = ? WHERE id = ?",
                "message deleted",
                messageId
            );

            broadcastChatEvent("delete", { id: messageId });
            broadcastPrivateEvent(
                "warn",
                {
                    nickname: message.nickname,
                    messageId,
                },
                (client) => client.nickname === normalizeNickname(message.nickname)
            );

            return res.json({ ok: true, nickname: message.nickname });
        }
    );

    chatRouter.post(
        "/admin/users/:nickname/ban",
        requireAuth,
        requireAdmin,
        async (req: Request, res: Response) => {
            const rawNickname = String(req.params.nickname || "").trim();
            const nickname = normalizeNickname(rawNickname);
            if (!validateNickname(rawNickname)) {
                return res.status(400).json({ error: "Invalid username" });
            }

            const user = await findUserByNickname(nickname);
            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }
            if (user.is_admin === 1) {
                return res.status(403).json({ error: "Admin accounts cannot be banned" });
            }

            await db.exec("BEGIN IMMEDIATE TRANSACTION");

            try {
                await db.run(
                    "UPDATE users SET banned = 1 WHERE nickname = ? COLLATE NOCASE",
                    nickname
                );
                await db.run(
                    "UPDATE messages SET body = ? WHERE nickname = ? COLLATE NOCASE",
                    "message deleted",
                    nickname
                );

                const createdAt = new Date().toISOString();
                const logResult = await db.run(
                    "INSERT INTO messages (nickname, body, created_at) VALUES (?, ?, ?)",
                    "system",
                    `user ${nickname} has been banned`,
                    createdAt
                );

                await db.run(
                    "DELETE FROM messages WHERE id NOT IN (" +
                    "SELECT id FROM messages ORDER BY id DESC LIMIT 100" +
                    ")"
                );

                await db.exec("COMMIT");

                broadcastChatEvent("purge", { nickname });
                broadcastPrivateEvent(
                    "ban",
                    { nickname },
                    (client) => client.nickname === nickname
                );
                broadcastChatEvent("message", {
                    id: logResult.lastID,
                    nickname: "system",
                    body: `user ${nickname} has been banned`,
                    created_at: createdAt,
                    is_admin: false,
                });
            } catch (error) {
                await db.exec("ROLLBACK");
                throw error;
            }

            return res.json({ ok: true });
        }
    );

    chatRouter.get(
        "/admin/users/active",
        requireAuth,
        requireAdmin,
        async (_req: Request, res: Response) => {
            const rows = await db.all<Array<{ nickname: string; created_at: string }>>(
                "SELECT nickname, created_at FROM users WHERE banned = 0 AND is_admin = 0 ORDER BY nickname COLLATE NOCASE"
            );
            return res.json({ users: rows });
        }
    );

    chatRouter.get(
        "/admin/users/banned",
        requireAuth,
        requireAdmin,
        async (_req: Request, res: Response) => {
            const rows = await db.all<Array<{ nickname: string; created_at: string }>>(
                "SELECT nickname, created_at FROM users WHERE banned = 1 AND is_admin = 0 ORDER BY nickname COLLATE NOCASE"
            );
            return res.json({ users: rows });
        }
    );

    chatRouter.post(
        "/admin/users/:nickname/unban",
        requireAuth,
        requireAdmin,
        async (req: Request, res: Response) => {
            const rawNickname = String(req.params.nickname || "").trim();
            const nickname = normalizeNickname(rawNickname);
            if (!validateNickname(rawNickname)) {
                return res.status(400).json({ error: "Invalid username" });
            }

            const user = await db.get<{ banned: number }>(
                "SELECT banned FROM users WHERE nickname = ? COLLATE NOCASE",
                nickname
            );
            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            await db.exec("BEGIN IMMEDIATE TRANSACTION");

            try {
                await db.run(
                    "UPDATE users SET banned = 0 WHERE nickname = ? COLLATE NOCASE",
                    nickname
                );

                const createdAt = new Date().toISOString();
                const logResult = await db.run(
                    "INSERT INTO messages (nickname, body, created_at) VALUES (?, ?, ?)",
                    "system",
                    `user ${nickname} has been unbanned`,
                    createdAt
                );

                await db.run(
                    "DELETE FROM messages WHERE id NOT IN (" +
                    "SELECT id FROM messages ORDER BY id DESC LIMIT 100" +
                    ")"
                );

                await db.exec("COMMIT");

                broadcastChatEvent("message", {
                    id: logResult.lastID,
                    nickname: "system",
                    body: `user ${nickname} has been unbanned`,
                    created_at: createdAt,
                    is_admin: false,
                });
            } catch (error) {
                await db.exec("ROLLBACK");
                throw error;
            }

            return res.json({ ok: true });
        }
    );

    chatRouter.delete(
        "/admin/users/:nickname",
        requireAuth,
        requireAdmin,
        async (req: Request, res: Response) => {
            const rawNickname = String(req.params.nickname || "").trim();
            const nickname = normalizeNickname(rawNickname);
            if (!validateNickname(rawNickname)) {
                return res.status(400).json({ error: "Invalid username" });
            }

            const user = await findUserByNickname(nickname);
            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }
            if (user.is_admin === 1) {
                return res.status(403).json({ error: "Admin accounts cannot be deleted here" });
            }

            await db.exec("BEGIN IMMEDIATE TRANSACTION");

            try {
                await db.run("DELETE FROM messages WHERE nickname = ? COLLATE NOCASE", nickname);
                await db.run("DELETE FROM users WHERE nickname = ? COLLATE NOCASE", nickname);
                await db.exec("COMMIT");
            } catch (error) {
                await db.exec("ROLLBACK");
                throw error;
            }

            broadcastChatEvent("purge", { nickname });

            return res.json({ ok: true });
        }
    );

    app.use("/chat", chatRouter);

    app.use(express.static(STATIC_DIR, { index: false }));
    app.get("*", (req: Request, res: Response, next: NextFunction) => {
        if (req.path.startsWith("/chat/") || req.path.startsWith("/iptv/")) {
            return next();
        }
        if (req.path === "/chat" || req.path === "/iptv") {
            return next();
        }
        return res.sendFile(path.join(STATIC_DIR, "index.html"), (err: NodeJS.ErrnoException | null) => {
            if (err) {
                next();
            }
        });
    });

    const server = app.listen(PORT, () => {
        console.log(`andromeda app listening on ${PORT}`);
    });

    server.requestTimeout = 0;
    server.timeout = 0;
    server.keepAliveTimeout = 75_000;
    server.headersTimeout = 90_000;
}

main().catch((err) => {
    console.error("Failed to start server", err);
    process.exit(1);
});
