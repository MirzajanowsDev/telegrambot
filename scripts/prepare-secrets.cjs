const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const dotenv = require('dotenv');
const { createBot } = require('../src/bot');

function prepareSecrets(envFile = '.env') {
  const env = dotenv.parse(fs.readFileSync(envFile));
  // Validate configuration before modifying deployment files or secrets.
  createBot(env, {});
  const configPath = path.resolve('wrangler.jsonc');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  const privateKeys = ['BOT_TOKEN', 'ADMIN_ID', 'PAYMENT_RU', 'PAYMENT_KG',
    'PAYMENT_UZ_ANDROID', 'PAYMENT_UZ_GEMINI', 'PAYMENT_UZ_CS16', 'PAYMENT_UZ_DOTA2'];
  const values = {};
  for (const key of privateKeys) if (env[key]) values[key] = env[key];
  const secretsPath = path.resolve('.wrangler/secrets.private.json');
  const prior = fs.existsSync(secretsPath) ? JSON.parse(fs.readFileSync(secretsPath, 'utf8')) : {};
  values.WEBHOOK_SECRET = env.WEBHOOK_SECRET || prior.WEBHOOK_SECRET || randomBytes(32).toString('hex');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(values.WEBHOOK_SECRET)) throw new Error('Invalid WEBHOOK_SECRET');
  for (const [key, value] of Object.entries(env)) {
    if (/^(PRICE_(ANDROID|IPHONE|CS16|GEMINI|DOTA2)_(RU|UZ|KG)|CHANNEL_(ID|CS16_ID|DOTA2_ID)|INVITE_EXPIRE_MINUTES|DEFAULT_SUPPORT_USERNAME|ADMIN_USERNAME)$/.test(key)) {
      config.vars[key] = value;
    }
  }
  fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
  fs.writeFileSync(secretsPath, JSON.stringify(values, null, 2), { mode: 0o600 });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2)+'\n');
  return Object.keys(values);
}
if (require.main === module) {
  try { console.log('Prepared secret names:', prepareSecrets(process.argv[2]).join(', ')); }
  catch (error) { console.error('Configuration preparation failed:', error.code || error.message); process.exitCode = 1; }
}
module.exports = { prepareSecrets };
