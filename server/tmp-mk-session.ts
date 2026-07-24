import { db } from './db';
import { sql } from 'drizzle-orm';
(async () => {
  const users = await db.execute(sql`SELECT id, username, role, is_active FROM users WHERE is_active = true LIMIT 10`);
  const u = (users.rows as any[]).find(r => ['developer','admin'].includes(r.role)) || (users.rows as any[])[0];
  console.log('USER=' + u.username + ' role=' + u.role);
  const sid = 'agent-debug-' + Math.random().toString(36).slice(2);
  await db.execute(sql`INSERT INTO sessions (id, user_id, username, expires_at) VALUES (${sid}, ${u.id}, ${u.username}, NOW() + interval '1 hour')`);
  console.log('SESSION=' + sid);
  process.exit(0);
})();
