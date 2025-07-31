import { sql } from 'bun';

class Database {
    constructor() {
        const databaseUrl = process.env.DATABASE_URL;
        
        if (!databaseUrl) {
            throw new Error('DATABASE_URL environment variable is required');
        }

        // Use Bun's built-in SQL template literal function
        this.sql = sql.connect(databaseUrl, {
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            max: 20,
            idleTimeout: 20000,
            connectTimeout: 10000,
            applicationName: 'bookstore-bun'
        });
    }

    async transaction(callback) {
        return await this.sql.begin(async (tx) => {
            return await callback(tx);
        });
    }

    async close() {
        await this.sql.end();
    }
}

export default new Database();