import postgres from 'postgres';

class Database {
    constructor() {
        const databaseUrl = process.env.DATABASE_URL;
        
        if (!databaseUrl) {
            throw new Error('DATABASE_URL environment variable is required');
        }

        this.sql = postgres(databaseUrl, {
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            max: 20,
            idle_timeout: 20000, // 20 seconds in milliseconds
            connect_timeout: 10000, // 10 seconds in milliseconds
            connection: {
                application_name: 'bookstore-bun',
            },
            transform: {
                undefined: null
            },
            onnotice: () => {}, // Suppress notices
            debug: process.env.NODE_ENV === 'development'
        });
    }

    // Direct access to sql template function for queries

    async transaction(callback) {
        return await this.sql.begin(async (sql) => {
            return await callback(sql);
        });
    }

    async close() {
        await this.sql.end();
    }
}

export default new Database();