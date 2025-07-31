import { join } from 'path';
import db from './connection.js';

export async function runMigrations() {
    try {
        console.log('Running database migrations...');
        
        // Read and execute schema using Bun.file if available, fallback to Node.js
        const schemaPath = join(import.meta.dir, 'schema.sql');
        let schema;
        
        if (typeof Bun !== 'undefined' && Bun.file) {
            const file = Bun.file(schemaPath);
            schema = await file.text();
        } else {
            const { readFileSync } = await import('fs');
            schema = readFileSync(schemaPath, 'utf8');
        }
        
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