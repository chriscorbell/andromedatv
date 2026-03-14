import bcrypt from "bcryptjs";
import fs from "fs/promises";
import crypto from "crypto";
import type { Database } from "sqlite";
import {
    getNicknameValidationError,
    getPasswordValidationError,
    normalizeNickname,
} from "./lib/auth";

export async function loadOrCreateJwtSecret(
    jwtSecret: string,
    jwtSecretPath: string,
): Promise<string> {
    if (jwtSecret) {
        return jwtSecret;
    }

    try {
        const persistedSecret = (await fs.readFile(jwtSecretPath, "utf8")).trim();
        if (persistedSecret) {
            console.log(`Loaded JWT secret from ${jwtSecretPath}`);
            return persistedSecret;
        }
    } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code !== "ENOENT") {
            throw error;
        }
    }

    const generatedSecret = crypto.randomBytes(48).toString("hex");
    await fs.writeFile(jwtSecretPath, generatedSecret, {
        encoding: "utf8",
        mode: 0o600,
    });
    console.log(`Generated JWT secret at ${jwtSecretPath}`);
    return generatedSecret;
}

export async function ensureInitialAdmin(options: {
    db: Database;
    nickname: string;
    password: string;
}) {
    const { db, nickname: initialNickname, password: initialPassword } = options;
    const adminCount = await db.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM users WHERE is_admin = 1"
    );
    if ((adminCount?.count || 0) > 0) {
        return;
    }

    if (!initialNickname || !initialPassword) {
        console.warn(
            "No admin user configured. Set INITIAL_ADMIN_NICKNAME and INITIAL_ADMIN_PASSWORD to bootstrap one."
        );
        return;
    }

    const nicknameError = getNicknameValidationError(initialNickname);
    if (nicknameError) {
        throw new Error(`INITIAL_ADMIN_NICKNAME is invalid: ${nicknameError}`);
    }

    const passwordError = getPasswordValidationError(initialPassword);
    if (passwordError) {
        throw new Error(`INITIAL_ADMIN_PASSWORD is invalid: ${passwordError}`);
    }

    const nickname = normalizeNickname(initialNickname);
    const passwordHash = await bcrypt.hash(initialPassword, 10);
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
}
