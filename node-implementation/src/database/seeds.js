const fs = require('fs');
const path = require('path');
const db = require('./connection');

async function seedDatabase() {
    try {
        console.log('Seeding database with sample data...');
        
        // Read and execute seeds
        const seedsPath = path.join(__dirname, 'seeds.sql');
        const seeds = fs.readFileSync(seedsPath, 'utf8');
        
        await db.query(seeds);
        console.log('✅ Database seeded successfully');
        
    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
}

// Run seeding if this file is executed directly
if (require.main === module) {
    seedDatabase().then(() => {
        console.log('Seeding completed');
        process.exit(0);
    });
}

module.exports = { seedDatabase };