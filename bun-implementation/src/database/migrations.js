import { join } from 'path';
import db from './connection.js';

export async function runMigrations() {
    try {
        console.log('Running database migrations...');
        
        // Use postgres.js sql.file() - works with both Bun and Node.js
        const schemaPath = join(import.meta.dir, 'schema.sql');
        await db.sql.file(schemaPath);
        console.log('✅ Database schema created successfully');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run migrations if this file is executed directly
if (import.meta.main) {
    await runMigrations();
    console.log('Migrations completed');
    process.exit(0);
}