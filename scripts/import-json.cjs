const fs = require('node:fs');

function importSql(db) {
  if (!db || typeof db.users !== 'object' || typeof db.payments !== 'object') throw new Error('Expected users and payments objects');
  const quote = value => value == null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
  const statements = [];
  for (const [id, user] of Object.entries(db.users)) {
    if (!/^\d+$/.test(id) || !user || typeof user !== 'object') throw new Error('Invalid user record');
    statements.push(`INSERT OR IGNORE INTO users (id, data) VALUES (${quote(id)}, ${quote(JSON.stringify(user))});`);
  }
  for (const [id, entry] of Object.entries(db.payments)) {
    if (!entry || !Number.isSafeInteger(entry.user_id) || !['pending','approved','rejected'].includes(entry.status)) throw new Error('Invalid payment record');
    const payment = { ...entry, id };
    statements.push(`INSERT OR IGNORE INTO payments (id, user_id, product, status, created_at, data) VALUES (${quote(id)}, ${entry.user_id}, ${quote(entry.product)}, ${quote(entry.status)}, ${quote(entry.created_at || '')}, ${quote(JSON.stringify(payment))});`);
  }
  return statements.join('\n')+'\n';
}
if (require.main === module) {
  try {
    const output = process.argv[3];
    if (!output || !output.endsWith('.private.sql')) throw new Error('Output must end in .private.sql');
    const db = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    fs.writeFileSync(output, importSql(db), { mode: 0o600 });
    console.log(`Prepared ${Object.keys(db.users).length} users and ${Object.keys(db.payments).length} payments; existing rows will not be overwritten.`);
  } catch (error) { console.error('Import preparation failed:', error.code || error.message); process.exitCode = 1; }
}
module.exports = { importSql };
