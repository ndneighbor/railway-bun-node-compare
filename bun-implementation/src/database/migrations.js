import { join } from 'path';
import { readFileSync } from 'fs';
import db from './connection.js';

export async function runMigrations() {
    try {
        console.log('Running database migrations...');
        
        // Read schema file and execute SQL
        const schemaPath = join(import.meta.dir, 'schema.sql');
        const schema = readFileSync(schemaPath, 'utf8');
        
        // Execute the entire schema file as one statement
        // Bun.SQL should handle multiple statements in one execution
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