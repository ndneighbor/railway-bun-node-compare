import { join } from 'path';
import db from './connection.js';

export async function seedDatabase() {
    try {
        console.log('Seeding database with sample data...');
        
        // Use sql.file() - works with both Bun.sql and postgres.js
        const seedsPath = join(import.meta.dir, 'seeds.sql');
        await db.sql.file(seedsPath);
        console.log('✅ Database seeded successfully');
        
    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
}

// Run seeding if this file is executed directly
if (import.meta.main) {
    await seedDatabase();
    console.log('Seeding completed');
    process.exit(0);
}