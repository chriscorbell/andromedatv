import { initDb } from "../db";
import { seedAnidbMetadataCacheFromJellyfin } from "../lib/jellyfin-metadata-seed";

const DEFAULT_JELLYFIN_DB_PATH = "/docker/data/jellyfin/config/data/jellyfin.db";
const DEFAULT_ANDROMEDA_DB_PATH = process.env.DB_PATH || "/data/andromeda.db";

type CliOptions = {
    andromedaDbPath: string;
    help: boolean;
    jellyfinDbPath: string;
};

function printUsage() {
    console.log(
        [
            "Usage: node dist/scripts/seed-anidb-from-jellyfin.js [options]",
            "",
            "Options:",
            `  --jellyfin-db <path>  Jellyfin SQLite DB (default: ${DEFAULT_JELLYFIN_DB_PATH})`,
            `  --db <path>           AndromedaTV SQLite DB (default: ${DEFAULT_ANDROMEDA_DB_PATH})`,
            "  --help                Show this help",
            "",
            "This is an offline pre-run migration. It is not invoked by normal app startup.",
        ].join("\n")
    );
}

function parseArgs(args: string[]): CliOptions {
    const options: CliOptions = {
        andromedaDbPath: DEFAULT_ANDROMEDA_DB_PATH,
        help: false,
        jellyfinDbPath: DEFAULT_JELLYFIN_DB_PATH,
    };

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--help" || arg === "-h") {
            options.help = true;
            continue;
        }
        if (arg === "--jellyfin-db") {
            const value = args[index + 1];
            if (!value) {
                throw new Error("--jellyfin-db requires a path");
            }
            options.jellyfinDbPath = value;
            index += 1;
            continue;
        }
        if (arg === "--db") {
            const value = args[index + 1];
            if (!value) {
                throw new Error("--db requires a path");
            }
            options.andromedaDbPath = value;
            index += 1;
            continue;
        }
        throw new Error(`Unknown option: ${arg}`);
    }

    return options;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printUsage();
        return;
    }

    const db = await initDb(options.andromedaDbPath);
    try {
        const result = await seedAnidbMetadataCacheFromJellyfin({
            db,
            jellyfinDbPath: options.jellyfinDbPath,
        });

        console.log(
            [
                `Seeded AniDB Metadata Cache from ${result.sourcePath}`,
                `Series upserted: ${result.upsertedSeriesCount}`,
                `Episodes upserted: ${result.upsertedEpisodeCount}`,
                `Series skipped: ${result.skippedSeriesCount}`,
                `Episodes skipped: ${result.skippedEpisodeCount}`,
            ].join("\n")
        );
    } finally {
        await db.close();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
