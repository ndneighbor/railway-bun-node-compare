import { readFileSync } from 'fs';
import { join } from 'path';
import db from './connection.js';

export async function runMigrations() {
    try {
        console.log('Running database migrations...');
        
        // Read and execute schema
        const schemaPath = join(import.meta.dir, 'schema.sql');
        const schema = readFileSync(schemaPath, 'utf8');
        
        await db.sql.unsafe(schema);
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