const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Miniflare, Response, convertV4MiniflareOptions } = require('miniflare');
const { D1Store } = require('../src/d1-store');

let mf, db, store;
let updateId = 1;
let messageId = 1;
const calls = [];
let failInvite = false;
let sendMessageError = 0;
const secret = 'test-webhook-secret';

before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath: 'dist/worker/worker.js',
    compatibilityDate: '2026-10-25', compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'test-db' },
    bindings: { BOT_TOKEN: '42:test-only-token', ADMIN_ID: '1', WEBHOOK_SECRET: secret,
      CHANNEL_ID: '-100111', CHANNEL_CS16_ID: '-100222', CHANNEL_DOTA2_ID: '-100333',
      PAYMENT_RU: 'RU payment', PAYMENT_KG: 'KG payment',
      PAYMENT_UZ_ANDROID: 'UZ games', PAYMENT_UZ_GEMINI: 'UZ Gemini' },
    outboundService: async request => {
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://api.telegram.org');
      const method = url.pathname.split('/').at(-1);
      const payload = await request.json();
      calls.push({ method, payload });
      if (method === 'sendMessage' && sendMessageError) {
        const code = sendMessageError;
        sendMessageError = 0;
        return Response.json({ ok: false, error_code: code }, { status: code });
      }
      if (method === 'createChatInviteLink' && failInvite) {
        failInvite = false;
        return Response.json({ ok: false, error_code: 403 }, { status: 403 });
      }
      let result = true;
      if (method === 'getMe') result = { id: 42, is_bot: true, first_name: 'Test', username: 'test_bot' };
      if (method === 'createChatInviteLink') result = { invite_link: 'https://t.me/+test' };
      if (['sendMessage','editMessageText','forwardMessage'].includes(method)) {
        result = { message_id: messageId++, date: 1, chat: { id: payload.chat_id || 1, type: 'private' }, text: payload.text || '' };
      }
      return Response.json({ ok: true, result });
    }
  }));
  db = await mf.getD1Database('DB');
  const statements = fs.readFileSync('migrations/0001_initial.sql','utf8').replace(/^\uFEFF/,'')
    .split(';').map(s => s.trim()).filter(Boolean);
  await db.batch(statements.map(sql => db.prepare(sql)));
  store = new D1Store(db);
});
after(async () => { await mf?.dispose(); });

function message(user, text, extra = {}) {
  return { update_id: updateId++, message: { message_id: messageId++, date: 1,
    from: { id: user, is_bot: false, first_name: 'Buyer' }, chat: { id: user, type: 'private' },
    text, ...(text?.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.length }] } : {}), ...extra } };
}
function callback(user, data) {
  return { update_id: updateId++, callback_query: { id: String(updateId), data,
    from: { id: user, is_bot: false, first_name: 'Buyer' }, chat_instance: 'test',
    message: { message_id: messageId++, date: 1, chat: { id: user, type: 'private' }, text: 'menu' } } };
}
async function send(update, expected = 200) {
  const response = await mf.dispatchFetch('https://bot.test/telegram', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify(update)
  });
  assert.equal(response.status, expected, await response.text());
}

test('Worker protects webhook, validates input and checks D1 health', async () => {
  assert.equal((await mf.dispatchFetch('https://bot.test/health')).status, 200);
  assert.equal((await mf.dispatchFetch('https://bot.test/telegram')).status, 405);
  assert.equal((await mf.dispatchFetch('https://bot.test/unknown')).status, 404);
  assert.equal((await mf.dispatchFetch('https://bot.test/telegram', { method: 'POST', body: '{}' })).status, 403);
  await send({ update_id: 'bad' }, 400);
  const large = await mf.dispatchFetch('https://bot.test/telegram', { method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }, body: 'x'.repeat(256*1024+1) });
  assert.equal(large.status, 400);
});

test('D1 patches preserve explicit nulls and independent concurrent user fields', async () => {
  await store.setUser(900, { product: 'dota2', waiting_receipt: true });
  await Promise.all([store.setUser(900, { lang: 'uz' }), store.setUser(900, { product: null })]);
  assert.deepEqual(await store.getUser(900), { product: null, waiting_receipt: true, lang: 'uz' });
});

for (const lang of ['ru','uz']) {
  for (const method of ['ru','uz','kg']) {
    test(`Worker → Telegram transport → D1 complete ${lang}/${method} Dota 2 flow`, async () => {
      const user = updateId + 100;
      await send(message(user, '/start'));
      await send(message(user, lang === 'ru' ? '🇷🇺 Русский' : "🇺🇿 O'zbekcha"));
      await send(callback(user, 'product_dota2'));
      await send(callback(user, 'choose_payment'));
      await send(callback(user, `pay_dota2_${method}`));
      await send(callback(user, 'send_receipt'));
      const receipt = method === 'uz'
        ? message(user, undefined, { document: { file_id: 'receipt', file_unique_id: 'receipt', mime_type: 'application/pdf' } })
        : message(user, undefined, { photo: [{ file_id: 'receipt', file_unique_id: 'receipt', width: 100, height: 100 }] });
      await send(receipt);
      const paymentId = `${receipt.message.message_id}_${user}`;
      const payment = await store.getPayment(paymentId);
      assert.equal(payment.status, 'pending');
      assert.equal(payment.lang, lang);
      assert.equal(payment.product, 'dota2');
      assert.equal(payment.price, { ru: '500 ₽', uz: '60 000 сум', kg: '500 сом' }[method]);
      await send(callback(user, 'status'));
      const beforeDuplicate = calls.length;
      await send(receipt);
      assert.equal(calls.length, beforeDuplicate);
      await send(callback(user, 'product_gemini'));
      const beforeInvites = calls.filter(c => c.method === 'createChatInviteLink').length;
      await Promise.all([send(callback(1, `approve:${paymentId}`)), send(callback(1, `approve:${paymentId}`))]);
      const invites = calls.filter(c => c.method === 'createChatInviteLink');
      assert.equal(invites.length, beforeInvites + 1);
      assert.equal(invites.at(-1).payload.chat_id, '-100333');
      assert.equal(invites.at(-1).payload.member_limit, 1);
      assert.equal((await store.getPayment(paymentId)).status, 'approved');
      await send(callback(1, `reject:${paymentId}`));
      assert.equal((await store.getPayment(paymentId)).status, 'approved');
    });
  }
}

test('D1 payment CAS prevents approval/rejection races and preserves other payments', async () => {
  for (const id of ['race','other']) await store.createPayment({ id, user_id: 55, product: 'dota2', status: 'pending', created_at: new Date().toISOString() });
  const claims = await Promise.all([store.claimPayment('race'), store.claimPayment('race')]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await store.getPayment('race')).status, 'processing');
  const payment = claims.find(Boolean);
  payment.status = 'approved';
  await store.savePayment(payment);
  assert.equal((await store.getPayment('other')).status, 'pending');
  assert.equal(await store.claimPayment('race'), null);
});

test('Worker rejects unauthorized admin and handles invite failure plus rejection/retry', async () => {
  const payment = { id: 'failure', user_id: 66, product: 'dota2', product_name: 'Dota 2', status: 'pending',
    lang: 'uz', payment_method: 'kg', price: '600 сом', created_at: new Date().toISOString() };
  await store.createPayment(payment);
  await send(callback(66, 'approve:failure'));
  assert.equal((await store.getPayment('failure')).status, 'pending');
  failInvite = true;
  await send(callback(1, 'approve:failure'));
  assert.equal((await store.getPayment('failure')).status, 'pending');
  await send(callback(1, 'reject:failure'));
  assert.equal((await store.getPayment('failure')).status, 'rejected');
  await send(callback(66, 'retry:failure'));
  const user = await store.getUser(66);
  assert.equal(user.product, 'dota2');
  assert.equal(user.waiting_receipt, true);
});

test('D1 webhook leases distinguish in-flight, failed/retried and completed updates', async () => {
  const a = await store.claimUpdate(999999);
  assert.ok(a.token);
  assert.equal((await store.claimUpdate(999999)).done, false);
  await store.releaseUpdate(999999, a.token);
  const b = await store.claimUpdate(999999);
  assert.ok(b.token);
  await store.finishUpdate(999999, b.token);
  assert.equal((await store.claimUpdate(999999)).done, true);
});

test('Worker resumes an interrupted receipt using its original product and price', async () => {
  const user = 78;
  const receipt = message(user, undefined, { photo: [{ file_id: 'saved', file_unique_id: 'saved', width: 100, height: 100 }] });
  const id = `${receipt.message.message_id}_${user}`;
  await store.createPayment({ id, user_id: user, product: 'dota2', product_name: 'Dota 2', lang: 'uz',
    payment_method: 'kg', price: '600 сом', country: 'Кыргызстан', status: 'pending', created_at: new Date().toISOString() });
  await store.setUser(user, { lang: 'ru', product: 'gemini', waiting_receipt: false });
  await send(receipt);
  assert.equal((await store.getPayment(id)).receipt_notified, true);
  assert.ok(calls.some(c => c.method === 'sendMessage' && c.payload.chat_id === 1 && c.payload.text.includes('600 сом')));
});

test('marking receipt notification cannot overwrite an approved payment', async () => {
  const id = 'notify-race';
  await store.createPayment({ id, user_id: 79, product: 'dota2', status: 'pending', created_at: new Date().toISOString() });
  const payment = await store.claimPayment(id);
  payment.status = 'approved';
  await store.savePayment(payment);
  await store.markReceiptNotified(id);
  assert.equal((await store.getPayment(id)).status, 'approved');
});


test('permanent Telegram reply errors do not block later updates', async () => {
  const update = message(808, '/start');
  sendMessageError = 403;
  await send(update);
  assert.equal((await store.claimUpdate(update.update_id)).done, true);
  await send(message(809, '/start'));
  assert.ok((await store.getUser(809)).language_prompt_message_id);
});

test('Telegram server errors and rate limits remain retryable', async () => {
  for (const code of [500, 429]) {
    const update = message(810 + code, '/start');
    sendMessageError = code;
    await send(update, 503);
    await send(update);
    assert.ok((await store.getUser(810 + code)).language_prompt_message_id);
  }
});
