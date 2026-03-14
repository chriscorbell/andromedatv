export function getNicknameValidationError(value: string): string | null {
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

export function validateNickname(value: string): boolean {
    return getNicknameValidationError(value) === null;
}

export function normalizeNickname(value: string): string {
    return value.trim().toLowerCase();
}

export function getPasswordValidationError(value: string): string | null {
    if (value.length < 6) {
        return "Password must be at least 6 characters.";
    }
    if (value.length > 72) {
        return "Password must be 72 characters or fewer.";
    }
    return null;
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
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

export function validateMessage(value: string): boolean {
    return value.length >= 1 && value.length <= 500;
}

export function containsUrl(value: string): boolean {
    return /(https?:\/\/|www\.)\S+/i.test(value) ||
        /\b([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?/i.test(value);
}
