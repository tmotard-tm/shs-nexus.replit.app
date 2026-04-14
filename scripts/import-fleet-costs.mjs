import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import fs from 'fs';
import path from 'path';

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

const dir = '/tmp/fleet_cost_import';

async function main() {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  console.log(`Found ${files.length} chunk files to import`);
  
  const client = await pool.connect();
  let totalInserted = 0;
  
  try {
    for (let fi = 0; fi < files.length; fi++) {
      const rows = JSON.parse(fs.readFileSync(path.join(dir, files[fi]), 'utf8'));
      
      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const cols = Object.keys(batch[0]);
        const colList = cols.map(c => `"${c}"`).join(', ');
        
        const values = [];
        const params = [];
        let paramIdx = 1;
        
        for (const row of batch) {
          const placeholders = cols.map(c => {
            params.push(row[c]);
            return `$${paramIdx++}`;
          });
          values.push(`(${placeholders.join(', ')})`);
        }
        
        const sql = `INSERT INTO fs_fleet_cost_records (${colList}) VALUES ${values.join(', ')} ON CONFLICT DO NOTHING`;
        
        try {
          await client.query(sql, params);
          totalInserted += batch.length;
        } catch(e) {
          console.error(`Error in file ${files[fi]} batch ${i}:`, e.message);
        }
      }
      
      if ((fi + 1) % 20 === 0) {
        console.log(`  ... ${fi + 1}/${files.length} files, ${totalInserted} rows inserted`);
      }
    }
    
    console.log(`\nDone: ${totalInserted} rows inserted`);
    
    const result = await client.query('SELECT count(*) FROM fs_fleet_cost_records');
    console.log(`Total in table: ${result.rows[0].count}`);
    
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
