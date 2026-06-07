import type { Database } from "sqlite";

const databaseMutationLocks = new WeakMap<Database, Promise<void>>();

export async function withDatabaseMutationLock<T>(
    db: Database,
    action: () => Promise<T>
): Promise<T> {
    const previousLock = databaseMutationLocks.get(db) || Promise.resolve();
    let releaseLock = () => {};
    const currentLock = previousLock
        .catch(() => undefined)
        .then(() => new Promise<void>((resolve) => {
            releaseLock = resolve;
        }));

    databaseMutationLocks.set(db, currentLock);
    await previousLock.catch(() => undefined);

    try {
        return await action();
    } finally {
        releaseLock();
        if (databaseMutationLocks.get(db) === currentLock) {
            databaseMutationLocks.delete(db);
        }
    }
}

export async function runExclusiveTransaction<T>(
    db: Database,
    action: () => Promise<T>
): Promise<T> {
    return withDatabaseMutationLock(db, async () => {
        await db.exec("BEGIN IMMEDIATE TRANSACTION");
        try {
            const result = await action();
            await db.exec("COMMIT");
            return result;
        } catch (error) {
            await db.exec("ROLLBACK");
            throw error;
        }
    });
}
