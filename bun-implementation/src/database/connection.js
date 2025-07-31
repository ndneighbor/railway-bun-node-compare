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

    // Using SQL template tags for safe queries (no more unsafe string interpolation)
    async query(strings, ...values) {
        const start = Date.now();
        try {
            // Use postgres template tag for safe parameterized queries
            const result = await this.sql(strings, ...values);
            const duration = Date.now() - start;
            console.log('Query executed', { 
                query: strings[0]?.substring(0, 50), 
                duration, 
                rows: result.length 
            });
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