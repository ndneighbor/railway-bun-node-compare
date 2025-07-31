import postgres from 'postgres';

class Database {
    constructor() {
        const databaseUrl = process.env.DATABASE_URL;
        
        if (!databaseUrl) {
            throw new Error('DATABASE_URL environment variable is required');
        }

        // Use postgres.js which works great with Bun
        this.sql = postgres(databaseUrl, {
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            max: 20,
            idle_timeout: 20000,
            connect_timeout: 10000,
            connection: {
                application_name: 'bookstore-bun',
            },
            transform: {
                undefined: null
            },
            onnotice: () => {},
            debug: process.env.NODE_ENV === 'development'
        });
    }

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