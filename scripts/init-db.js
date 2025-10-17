import dotenv from 'dotenv';
import { runMigrations } from '../src/db/index.js';

dotenv.config();

console.log('Initializing database...');

try {
  await runMigrations();
  console.log('✓ Database initialized successfully');
  process.exit(0);
} catch (error) {
  console.error('Failed to initialize database:', error);
  process.exit(1);
}
