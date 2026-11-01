let repl;
export async function setup() {
    if (process.env.MONGO_TEST_URI) {
        process.env.MONGO_URI = process.env.MONGO_TEST_URI;
        process.env.MONGO_TRANSACTIONS = process.env.MONGO_TEST_TX ?? 'false';
        return;
    }
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGO_URI = repl.getUri();
    process.env.MONGO_TRANSACTIONS = 'true';
}
export async function teardown() {
    await repl?.stop();
}
