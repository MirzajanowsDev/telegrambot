const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JsonStore } = require('../src/json-store');
const { importSql } = require('../scripts/import-json.cjs');
const { createTelegramApi } = require('../src/telegram-api');

// Temporary persistence lives inside the ignored workspace directory.
test('legacy JSON storage persists users, receipts and atomic approval claims', async t => {
  fs.mkdirSync('.wrangler', { recursive: true });
  const dir = fs.mkdtempSync(path.resolve('.wrangler/test-json-'));
  const file = path.join(dir,'data.json');
  t.after(() => { fs.rmSync(dir, { recursive: true }); });
  const store = new JsonStore(file);
  await store.setUser(10, { product: 'dota2', lang: 'uz' });
  await store.setUser(10, { product: null });
  assert.deepEqual(await new JsonStore(file).getUser(10), { product: null, lang: 'uz' });
  const receipt = { id: 'receipt', user_id: 10, product: 'dota2', status: 'pending', created_at: new Date().toISOString() };
  assert.equal(await store.createPayment(receipt), true);
  assert.equal(await store.createPayment(receipt), false);
  const claims = await Promise.all([store.claimPayment('receipt'),store.claimPayment('receipt')]);
  assert.equal(claims.filter(Boolean).length,1);
  const claimed = claims.find(Boolean);
  claimed.status = 'approved';
  await store.savePayment(claimed);
  await store.markReceiptNotified('receipt');
  assert.equal((await store.getPayment('receipt')).status, 'approved');
  assert.equal((await store.listPayments(10,'dota2')).length,1);
});

test('legacy JSON import preserves IDs and quotes data without overwriting rows', () => {
  const sql = importSql({ users: { 10: { first_name: "O'zbek", product: null } },
    payments: { old_id: { user_id: 10, status: 'approved', invite_link: 'https://t.me/+old', created_at: '2026-10-01' } } });
  assert.match(sql, /INSERT OR IGNORE INTO users/);
  assert.match(sql, /O''zbek/);
  assert.match(sql, /old_id/);
  assert.match(sql, /https:\/\/t.me\/\+old/);
  assert.doesNotMatch(sql, /DELETE|DROP|REPLACE/);
  assert.throws(() => importSql({ users: {}, payments: { bad: { user_id: 'text', status: 'approved' } } }));
});

test('native Telegram transport never includes token URLs in thrown errors', async () => {
  const token = 'sensitive-token';
  const call = createTelegramApi(token, async () => { throw new Error(`fetch https://api.telegram.org/bot${token}/sendMessage`); });
  await assert.rejects(call('sendMessage', {}), error => !error.message.includes(token));
});

test('bot configuration reads the supplied environment instead of process globals', () => {
  const { createBot } = require('../src/bot');
  const env = { BOT_TOKEN: '42:test-token', ADMIN_ID: '1', CHANNEL_ID: '-100111',
    PAYMENT_RU: 'RU', PAYMENT_KG: 'KG', PAYMENT_UZ_ANDROID: 'UZ games', PAYMENT_UZ_GEMINI: 'UZ Gemini' };
  assert.doesNotThrow(() => createBot(env, {}));
  assert.throws(() => createBot({ ...env, PAYMENT_RU: '' }, {}), /PAYMENT_RU/);
});
