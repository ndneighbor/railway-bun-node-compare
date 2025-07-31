import { readFileSync } from 'fs';
import { join } from 'path';
import db from './connection.js';

export async function seedDatabase() {
    try {
        console.log('Seeding database with sample data...');
        
        // Read and execute seeds
        const seedsPath = join(import.meta.dir, 'seeds.sql');
        const seeds = readFileSync(seedsPath, 'utf8');
        
        await db.sql.unsafe(seeds);
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