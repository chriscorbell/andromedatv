import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

test("metadata contract documents sidecar overrides and AniDB refresh behavior", async () => {
    const contract = await fs.readFile(
        path.join(repoRoot, "docs", "metadata-contract.md"),
        "utf8",
    );

    assert.match(contract, /## Sidecar Override Format/);
    assert.match(contract, /andromeda\.sidecar\.json/);
    assert.match(contract, /"series"/);
    assert.match(contract, /"episodes"/);
    assert.match(contract, /"anidbSeriesId"/);
    assert.match(contract, /"chronologicalOrder"/);
    assert.match(contract, /## Allowed Override Fields/);
    assert.match(contract, /Chronological Episode Order/);
    assert.match(contract, /## Metadata Refresh/);
    assert.match(contract, /first-add/);
    assert.match(contract, /on-demand/);
    assert.match(contract, /## Rate Limits And Failure Behavior/);
    assert.match(contract, /Live playout must continue/);
});
