import postgres from 'postgres';

class Database {
    constructor() {
        this.sql = postgres(process.env.DATABASE_URL, {
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            max: 20,
            idle_timeout: 20,
            connect_timeout: 10,
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