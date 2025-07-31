#!/usr/bin/env bun

// Simple database connection test
import postgres from 'postgres';

console.log('🔍 Testing database connection...');
console.log('Environment variables:');
console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? 'Set' : 'Missing'}`);
console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'development'}`);

if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set');
    process.exit(1);
}

try {
    const sql = postgres(process.env.DATABASE_URL, {
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        max: 1,
        idle_timeout: 20000,
        connect_timeout: 10000,
        connection: {
            application_name: 'bookstore-bun-test',
        },
        debug: true
    });

    console.log('💫 Attempting connection...');
    const result = await sql`SELECT NOW() as current_time, version() as pg_version`;
    console.log('✅ Connection successful!');
    console.log('Server time:', result[0].current_time);
    console.log('PostgreSQL version:', result[0].pg_version);
    
    await sql.end();
    console.log('🔚 Connection closed');
    
} catch (error) {
    console.error('❌ Connection failed:', error);
    process.exit(1);
}