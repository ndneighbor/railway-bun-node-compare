import postgres from 'postgres';

class Database {
    constructor() {
        this.sql = postgres(process.env.DATABASE_URL, {
            ssl: process.env.NODE_ENV === 'production' ? 'require' : false,
            max: 20,
            idle_timeout: 20,
            connect_timeout: 10,
        });
    }

    async query(text, params = []) {
        const start = Date.now();
        try {
            const result = await this.sql.unsafe(text, params);
            const duration = Date.now() - start;
            console.log('Query executed', { text: text.substring(0, 50), duration, rows: result.length });
            return { rows: result, rowCount: result.length };
        } catch (error) {
            console.error('Database query error:', error);
            throw error;
        }
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