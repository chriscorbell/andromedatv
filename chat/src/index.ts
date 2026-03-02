import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs/promises";
import http from "http";
import https from "https";
import { initDb } from "./db";

const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || "";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const ERSATZTV_BASE_URL = process.env.ERSATZTV_BASE_URL || "";
const ADMIN_USER = "andromedatv";
const DB_PATH =
    process.env.DB_PATH ||
    path.resolve(__dirname, "..", "data", "chat.db");
const STATIC_DIR = path.resolve(__dirname, "..", "..", "dist");

if (!JWT_SECRET) {
    console.error("JWT_SECRET is required");
    process.exit(1);
}

if (!ERSATZTV_BASE_URL) {
    console.error("ERSATZTV_BASE_URL is required");
    process.exit(1);
}

type AuthedRequest = Request & { user?: { nickname: string } };
type StreamClient = {
    res: Response;
};

const streamClients = new Set<StreamClient>();
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

function validatePassword(value: string): boolean {
    return getPasswordValidationError(value) === null;
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

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
    const header = req.header("authorization") || "";
    const match = header.match(/^Bearer (.+)$/);
    if (!match) {
        return res.status(401).json({ error: "Missing auth token" });
    }

    try {
        const payload = jwt.verify(match[1], JWT_SECRET) as { nickname?: string };
        if (!payload.nickname) {
            return res.status(401).json({ error: "Invalid token" });
        }

        req.user = { nickname: normalizeNickname(payload.nickname) };
        return next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid token" });
    }
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
    if (normalizeNickname(req.user?.nickname || "") !== ADMIN_USER) {
        return res.status(403).json({ error: "Admin access required" });
    }

    return next();
}

function getNicknameFromToken(token: string): string | null {
    try {
        const payload = jwt.verify(token, JWT_SECRET) as { nickname?: string };
        return payload.nickname ? normalizeNickname(payload.nickname) : null;
    } catch (err) {
        return null;
    }
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
    return content.replace(/http:\/\/[^\s"'#]+\/iptv\//g, `${publicOrigin}/iptv/`);
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

function startHeartbeat() {
    if (heartbeatTimer) {
        return;
    }

    heartbeatTimer = setInterval(() => {
        for (const client of streamClients) {
            client.res.write(": heartbeat\n\n");
        }
    }, 25000);
}

async function main() {
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    const db = await initDb(DB_PATH);
    const ersatzBaseUrl = new URL(ERSATZTV_BASE_URL);
    const ersatzIptvBasePath = normalizeIptvBasePath(ersatzBaseUrl.pathname);

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
                            res.setHeader("content-length", Buffer.byteLength(rewritten, "utf8"));
                            res.send(rewritten);
                        } catch (err) {
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
        } catch (err: any) {
            if (String(err?.code) === "SQLITE_CONSTRAINT") {
                return res.status(409).json({ error: "Username already exists" });
            }
            return res.status(500).json({ error: "Failed to register" });
        }

        const token = jwt.sign({ nickname }, JWT_SECRET, { expiresIn: "7d" });
        return res.status(201).json({ nickname, token });
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
        }>(
            "SELECT nickname, password_hash, banned FROM users WHERE nickname = ? COLLATE NOCASE " +
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
        const token = jwt.sign({ nickname: canonicalNickname }, JWT_SECRET, { expiresIn: "7d" });
        return res.json({ nickname: canonicalNickname, token });
    });

    chatRouter.get("/messages", requireAuth, async (req: AuthedRequest, res: Response) => {
        const nickname = req.user?.nickname || "";
        const user = await db.get<{ banned: number }>(
            "SELECT banned FROM users WHERE nickname = ? COLLATE NOCASE",
            nickname
        );
        if (!user) {
            return res.status(401).json({ error: "Invalid token" });
        }
        if (user.banned) {
            return res.status(403).json({ error: "this account has been banned" });
        }

        const rows = await db.all<
            Array<{
                id: number;
                nickname: string;
                body: string;
                created_at: string;
            }>
        >(
            "SELECT id, nickname, body, created_at FROM messages ORDER BY id DESC LIMIT 100"
        );
        const messages = rows.slice().reverse();

        return res.json({ messages });
    });

    chatRouter.get("/messages/public", async (_req: Request, res: Response) => {
        const rows = await db.all<
            Array<{
                id: number;
                nickname: string;
                body: string;
                created_at: string;
            }>
        >(
            "SELECT id, nickname, body, created_at FROM messages ORDER BY id DESC LIMIT 100"
        );
        const messages = rows.slice().reverse();

        return res.json({ messages });
    });

    chatRouter.get("/messages/stream", async (req: Request, res: Response) => {
        const token = String(req.query?.token || "");
        const nickname = token ? getNicknameFromToken(token) : null;
        if (!nickname) {
            return res.status(401).json({ error: "Invalid token" });
        }

        const user = await db.get<{ banned: number }>(
            "SELECT banned FROM users WHERE nickname = ? COLLATE NOCASE",
            nickname
        );
        if (!user) {
            return res.status(401).json({ error: "Invalid token" });
        }
        if (user.banned) {
            return res.status(403).json({ error: "this account has been banned" });
        }

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.socket?.setTimeout(0);
        res.flushHeaders();

        res.write("retry: 5000\n\n");
        writeSseEvent(res, "ready", { ok: true });

        const client: StreamClient = { res };
        streamClients.add(client);
        startHeartbeat();

        req.on("close", () => {
            streamClients.delete(client);
            if (streamClients.size === 0 && heartbeatTimer) {
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

        const client: StreamClient = { res };
        streamClients.add(client);
        startHeartbeat();

        _req.on("close", () => {
            streamClients.delete(client);
            if (streamClients.size === 0 && heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }
        });

        return undefined;
    });

    chatRouter.post("/messages", requireAuth, async (req: AuthedRequest, res: Response) => {
        const nickname = req.user?.nickname || "";
        const user = await db.get<{ banned: number }>(
            "SELECT banned FROM users WHERE nickname = ? COLLATE NOCASE",
            nickname
        );
        if (!user) {
            return res.status(401).json({ error: "Invalid token" });
        }
        if (user.banned) {
            return res.status(403).json({ error: "this account has been banned" });
        }

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
        };

        for (const client of streamClients) {
            writeSseEvent(client.res, "message", message);
        }

        return res.status(201).json({ message });
    });

    chatRouter.post("/admin/clear", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
        await db.run("DELETE FROM messages");

        for (const client of streamClients) {
            writeSseEvent(client.res, "clear", { ok: true });
        }

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

            for (const client of streamClients) {
                writeSseEvent(client.res, "delete", { id: messageId });
            }

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

            for (const client of streamClients) {
                writeSseEvent(client.res, "delete", { id: messageId });
                writeSseEvent(client.res, "warn", {
                    nickname: message.nickname,
                    messageId,
                });
            }

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

            await db.run("UPDATE users SET banned = 1 WHERE nickname = ? COLLATE NOCASE", nickname);
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

            for (const client of streamClients) {
                writeSseEvent(client.res, "purge", { nickname });
                writeSseEvent(client.res, "ban", { nickname });
                writeSseEvent(client.res, "message", {
                    id: logResult.lastID,
                    nickname: "system",
                    body: `user ${nickname} has been banned`,
                    created_at: createdAt,
                });
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
                "SELECT nickname, created_at FROM users WHERE banned = 0 ORDER BY nickname COLLATE NOCASE"
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
                "SELECT nickname, created_at FROM users WHERE banned = 1 ORDER BY nickname COLLATE NOCASE"
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

            await db.run("UPDATE users SET banned = 0 WHERE nickname = ? COLLATE NOCASE", nickname);

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

            for (const client of streamClients) {
                writeSseEvent(client.res, "message", {
                    id: logResult.lastID,
                    nickname: "system",
                    body: `user ${nickname} has been unbanned`,
                    created_at: createdAt,
                });
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

            await db.run("DELETE FROM messages WHERE nickname = ? COLLATE NOCASE", nickname);
            await db.run("DELETE FROM users WHERE nickname = ? COLLATE NOCASE", nickname);

            for (const client of streamClients) {
                writeSseEvent(client.res, "purge", { nickname });
            }

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
