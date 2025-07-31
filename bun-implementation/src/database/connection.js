// Use Bun.sql when available, fallback to postgres.js for Node.js compatibility
let sql;

if (typeof Bun !== 'undefined' && Bun.sql) {
    // Native Bun.sql - 50% faster than Node.js PostgreSQL clients
    const { sql: bunSql } = await import('bun');
    sql = bunSql;
} else {
    // Fallback to postgres.js for Node.js
    const postgres = await import('postgres');
    const databaseUrl = process.env.DATABASE_URL;
    
    if (!databaseUrl) {
        throw new Error('DATABASE_URL environment variable is required');
    }

    sql = postgres.default(databaseUrl, {
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

class Database {
    constructor() {
        this.sql = sql;
    }

    async transaction(callback) {
        if (typeof Bun !== 'undefined' && Bun.sql) {
            // Bun.sql transaction syntax (may differ)
            return await this.sql.begin(callback);
        } else {
            // postgres.js transaction syntax
            return await this.sql.begin(async (sql) => {
                return await callback(sql);
            });
        }
    }

    async close() {
        if (this.sql.end) {
            await this.sql.end();
        }
    }
}

export default new Database();