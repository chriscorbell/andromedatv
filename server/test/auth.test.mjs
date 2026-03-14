import assert from "node:assert/strict";
import test from "node:test";

import * as auth from "../dist/lib/auth.js";

test("nickname validation and normalization follow the expected rules", () => {
    assert.equal(auth.getNicknameValidationError("ab"), "Username must be at least 3 characters.");
    assert.equal(
        auth.getNicknameValidationError("name with spaces"),
        "Username can only use letters, numbers, underscores, and hyphens."
    );
    assert.equal(auth.getNicknameValidationError("Andromeda_TV"), null);
    assert.equal(auth.validateNickname("valid-name"), true);
    assert.equal(auth.normalizeNickname("  Andromeda_TV  "), "andromeda_tv");
});

test("password and message helpers reject invalid input", () => {
    assert.equal(auth.getPasswordValidationError("12345"), "Password must be at least 6 characters.");
    assert.equal(auth.getPasswordValidationError("x".repeat(73)), "Password must be 72 characters or fewer.");
    assert.equal(auth.getPasswordValidationError("hunter2"), null);
    assert.equal(auth.validateMessage(""), false);
    assert.equal(auth.validateMessage("hello world"), true);
    assert.equal(auth.validateMessage("x".repeat(501)), false);
});

test("cookie parsing and URL detection handle common chat inputs", () => {
    assert.deepEqual(auth.parseCookieHeader("a=1; andromeda_stream=token%3D123"), {
        a: "1",
        andromeda_stream: "token=123",
    });
    assert.equal(auth.containsUrl("come hang out at https://example.com/live"), true);
    assert.equal(auth.containsUrl("see also example.org/path"), true);
    assert.equal(auth.containsUrl("plain chat message only"), false);
});
