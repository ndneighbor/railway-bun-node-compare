import { join } from 'path';
import db from './connection.js';

export async function seedDatabase() {
    try {
        console.log('Seeding database with sample data...');
        
        // Read and execute seeds using Bun.file if available, fallback to Node.js
        const seedsPath = join(import.meta.dir, 'seeds.sql');
        let seeds;
        
        if (typeof Bun !== 'undefined' && Bun.file) {
            const file = Bun.file(seedsPath);
            seeds = await file.text();
        } else {
            const { readFileSync } = await import('fs');
            seeds = readFileSync(seedsPath, 'utf8');
        }
        
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