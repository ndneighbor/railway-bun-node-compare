const fs = require('fs');
const path = require('path');
const db = require('./connection');

async function runMigrations() {
    try {
        console.log('Running database migrations...');
        
        // Read and execute schema
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        await db.query(schema);
        console.log('✅ Database schema created successfully');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run migrations if this file is executed directly
if (require.main === module) {
    runMigrations().then(() => {
        console.log('Migrations completed');
        process.exit(0);
    });
}

module.exports = { runMigrations };