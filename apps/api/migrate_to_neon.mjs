import { neon } from '@neondatabase/serverless';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

async function migrate() {
  console.log('Generating DDL migration script from Prisma schema...');
  const ddlScript = execSync(
    'npx prisma migrate diff --from-empty --to-schema-datamodel ./prisma/schema.prisma --script',
    { encoding: 'utf8' }
  );

  console.log(`DDL script generated (${ddlScript.length} characters).`);
  console.log('Connecting to Neon via HTTP port 443...');
  const sql = neon(process.env.DATABASE_URL);

  // Remove comments line-by-line then split into statements
  const cleanScript = ddlScript
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  const statements = cleanScript
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  console.log(`Executing ${statements.length} SQL statements on Neon PostgreSQL...`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      await sql.query(stmt);
    } catch (e) {
      console.warn(`Warning on statement ${i + 1}: ${e.message}`);
    }
  }

  console.log('Verifying created tables in Neon PostgreSQL...');
  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `;

  console.log(`Successfully migrated ${tables.length} tables to Neon:`);
  console.table(tables.map(t => t.table_name));
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
