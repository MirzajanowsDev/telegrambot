const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { Markup } = require('telegraf');

function setup(product, configured = true) {
  let db = { users: { 2: { product: 'android' } }, payments: {
    receipt: { product, user_id: 2, status: 'pending' }
  } };
  const actions = [];
  const hears = [];
  let startHandler;
  class FakeBot {
    action(pattern, handler) { actions.push({ pattern, handler }); }
    hears(trigger, handler) { hears.push({ trigger, handler }); }
    start(handler) { startHandler = handler; } on() {} catch() {}
    launch() { return Promise.resolve(); }
  }
  const context = vm.createContext({
    require(name) {
      if (name === 'dotenv') return { config() {} };
      if (name === 'telegraf') return { Telegraf: FakeBot, Markup };
      if (name === 'fs') return {
        readFileSync: () => JSON.stringify(db),
        mkdirSync: () => {},
        writeFileSync: (_, value) => { db = JSON.parse(value); },
        renameSync: () => {}
      };
      return require(name);
    },
    __dirname: path.resolve('src'), console,
    process: { pid: 123, env: {
      BOT_TOKEN: 'test', ADMIN_ID: '1', CHANNEL_ID: '-100111',
      PAYMENT_RU: '+70000000000 Bank', PAYMENT_KG: '+996000000000 Bank',
      PAYMENT_UZ_ANDROID: '1111 2222 3333 4444 Owner',
      PAYMENT_UZ_GEMINI: '5555 6666 7777 8888 Owner',
      ...(configured ? { CHANNEL_CS16_ID: '-100222', PRICE_CS16_RU: '100 ₽',
        PRICE_CS16_UZ: '10000 сум', PRICE_CS16_KG: '100 сом' } : {})
    }, once() {} }
  });
  vm.runInContext(fs.readFileSync(path.resolve('src/index.js'), 'utf8'), context);
  const channels = [];
  const replies = [];
  const sentMessages = [];
  const editedMessages = [];
  const deletedMessages = [];
  const replyExtras = [];
  const ctx = {
    from: { id: 1 }, match: ['', 'receipt'],
    callbackQuery: { message: { message_id: 99 } },
    message: { message_id: 100 },
    answerCbQuery: async () => {},
    reply: async (text, extra) => {
      replies.push(text);
      replyExtras.push(extra);
      return { message_id: 200 };
    },
    deleteMessage: async messageId => deletedMessages.push(messageId),
    editMessageText: async (text, extra) => editedMessages.push({ text, extra }),
    telegram: {
      createChatInviteLink: async (channel, options) => {
        channels.push(channel);
        assert.equal(options.member_limit, 1);
        return { invite_link: 'https://t.me/+test' };
      },
      sendMessage: async (chatId, text, extra) => sentMessages.push({ chatId, text, extra })
    }
  };
  return { context, channels, replies, replyExtras, sentMessages, editedMessages, deletedMessages, db: () => db,
    ctx,
    start: () => startHandler(ctx),
    approve: () => actions.find(a => String(a.pattern).includes('approve:')).handler(ctx),
    reject: () => actions.find(a => String(a.pattern).includes('reject:')).handler(ctx),
    retry: () => actions.find(a => String(a.pattern).includes('retry:')).handler(ctx),
    status: () => actions.find(a => a.pattern === 'status').handler(ctx),
    hear: text => hears.find(item => item.trigger === text).handler(ctx),
    selectScopedPayment: (productCode, methodCode) => {
      ctx.match = ['', productCode, methodCode];
      return actions.find(a => String(a.pattern).startsWith('/^pay_(android')).handler(ctx);
    }
  };
}

for (const product of ['cs16', 'android', 'iphone', undefined]) {
  test(`approval routes ${product || 'legacy payment'} to its channel`, async () => {
    const app = setup(product);
    await app.approve();
    assert.deepEqual(app.channels, [product === 'cs16' ? '-100222' : '-100111']);
    assert.equal(app.db().payments.receipt.status, 'approved');
  });
}

test('Gemini approval sends support contact without creating a channel invite', async () => {
  const app = setup('gemini');
  await app.approve();
  assert.deepEqual(app.channels, []);
  assert.equal(app.db().payments.receipt.status, 'approved');
  assert.match(JSON.stringify(app.sentMessages), /https:\/\/t\.me\/bahriddindev/);
  assert.match(app.editedMessages[0].text, /@bahriddindev/);
});

test('CS uses built-in channel and prices when optional env overrides are absent', async () => {
  const app = setup('cs16', false);
  await app.approve();
  assert.deepEqual(app.channels, ['-1004335642053']);
  assert.equal(app.db().payments.receipt.status, 'approved');
  assert.equal(vm.runInContext('products.cs16.prices.ru.amount', app.context), '700 ₽');
  assert.equal(vm.runInContext('products.cs16.prices.uz.amount', app.context), '50 000 сум');
  assert.equal(vm.runInContext('products.cs16.prices.kg.amount', app.context), '500 сом');
});

test('menu includes CS and configured prices enable payment', () => {
  const app = setup('cs16');
  assert.match(JSON.stringify(vm.runInContext('productKeyboard()', app.context)), /product_cs16/);
  assert.match(
    vm.runInContext("productTitle('ru')", app.context),
    /🎮 GENERALS & CS 1\.6 ANDROID & Gemini Pro/
  );
});

test('menu includes Gemini and support is product-specific', () => {
  const app = setup('gemini');
  assert.match(JSON.stringify(vm.runInContext('productKeyboard()', app.context)), /product_gemini/);
  assert.match(JSON.stringify(vm.runInContext("mainKeyboard('ru', 'gemini')", app.context)), /https:\/\/t\.me\/bahriddindev/);
  assert.match(JSON.stringify(vm.runInContext("mainKeyboard('ru', 'android')", app.context)), /https:\/\/t\.me\/mirzajonows/);
});

test('language and product navigation use the persistent reply keyboard', () => {
  const app = setup('android');
  const inlineKeyboard = vm.runInContext("mainKeyboard('ru', 'android').reply_markup.inline_keyboard", app.context);
  const replyKeyboard = vm.runInContext('replyMenuKeyboard().reply_markup', app.context);
  assert.equal(inlineKeyboard.flat().some(button => button.callback_data?.startsWith('lang_')), false);
  assert.equal(inlineKeyboard.flat().some(button => button.callback_data === 'choose_product'), false);
  assert.equal(replyKeyboard.resize_keyboard, true);
  assert.equal(replyKeyboard.is_persistent, true);
  assert.deepEqual(Array.from(replyKeyboard.keyboard[0]), ['🇷🇺 Русский', "🇺🇿 O'zbekcha"]);
  assert.equal(replyKeyboard.keyboard[1][0], '🛍 Product menu');
});

test('/start clears the previous purchase selection', async () => {
  const app = setup('android');
  app.db().users['1'] = { product: 'gemini', payment_method: 'uz', waiting_receipt: true };
  await app.start();
  assert.equal(app.db().users['1'].product, null);
  assert.equal(app.db().users['1'].payment_method, null);
  assert.equal(app.db().users['1'].waiting_receipt, false);
  assert.equal(app.replyExtras[0].reply_markup.is_persistent, true);
});

test('reply keyboard changes language without losing the selected product', async () => {
  const app = setup('android');
  app.db().users['1'] = { lang: 'ru', product: 'android', payment_method: 'ru' };
  await app.hear("🇺🇿 O'zbekcha");
  assert.equal(app.db().users['1'].lang, 'uz');
  assert.equal(app.db().users['1'].product, 'android');
  assert.match(app.replies[0], /Qulay to'lov/);
  assert.deepEqual(app.deletedMessages, [100]);
});

test('Product menu cancels unfinished selection and opens all products', async () => {
  const app = setup('gemini');
  app.db().users['1'] = { lang: 'ru', product: 'gemini', payment_method: 'uz', waiting_receipt: true };
  await app.hear('🛍 Product menu');
  assert.equal(app.db().users['1'].product, null);
  assert.equal(app.db().users['1'].payment_method, null);
  assert.equal(app.db().users['1'].waiting_receipt, false);
  assert.match(JSON.stringify(app.replyExtras[0]), /product_gemini/);
  assert.deepEqual(app.deletedMessages, [100]);
});

test('payment buttons retain the product shown on the original message', async () => {
  const app = setup('android');
  app.db().users['1'] = { lang: 'ru', product: 'android' };
  await app.selectScopedPayment('gemini', 'uz');
  assert.equal(app.db().users['1'].product, 'gemini');
  assert.equal(app.db().users['1'].payment_method, 'uz');
  assert.deepEqual(app.deletedMessages, [99]);
  assert.match(JSON.stringify(vm.runInContext("paymentKeyboard('ru', 'gemini')", app.context)), /pay_gemini_uz/);
});

test('old navigation message is kept if the next reply fails', async () => {
  const app = setup('android');
  app.db().users['1'] = { lang: 'ru', product: 'android' };
  app.ctx.reply = async () => { throw new Error('send failed'); };
  await assert.rejects(app.selectScopedPayment('android', 'ru'), /send failed/);
  assert.deepEqual(app.deletedMessages, []);
});

test('spaced card numbers remain fully copyable', () => {
  const app = setup('android');
  const result = vm.runInContext("splitRequisites('1234 5678 9012 3456 Card Owner')", app.context);
  assert.deepEqual({ number: result.number, label: result.label }, {
    number: '1234 5678 9012 3456',
    label: 'Card Owner'
  });
});

test('an approved payment cannot be overwritten as rejected', async () => {
  const app = setup('android');
  app.db().payments.receipt.status = 'approved';
  await app.reject();
  assert.equal(app.db().payments.receipt.status, 'approved');
  assert.match(app.replies[0], /Нельзя отклонить/);
});

test('payment status follows the currently selected product', async () => {
  const app = setup('android');
  app.db().users['1'] = { lang: 'ru', product: 'gemini' };
  app.db().payments = {
    android: { user_id: 1, product: 'android', product_name: '🎮 Generals Android', status: 'approved', country: 'RU', price: '500 ₽', created_at: '2026-01-02' },
    gemini: { user_id: 1, product: 'gemini', product_name: '🤖 Gemini Pro', status: 'pending', country: 'UZ', price: '50 000 сум', created_at: '2026-01-01' }
  };
  await app.status();
  assert.match(app.replies[0], /Gemini Pro/);
  assert.doesNotMatch(app.replies[0], /Generals Android/);
});

test('a rejected payment can restore the exact receipt flow', async () => {
  const app = setup('gemini');
  app.ctx.from.id = 2;
  app.db().users['2'] = { lang: 'uz', product: 'android', payment_method: 'ru', waiting_receipt: false };
  app.db().payments.receipt = {
    ...app.db().payments.receipt,
    product: 'gemini',
    product_name: '🤖 Gemini Pro',
    payment_method: 'uz',
    country: "🇺🇿 O'zbekiston",
    price: '50 000 сум',
    status: 'rejected',
    lang: 'uz'
  };
  await app.retry();
  assert.equal(app.db().users['2'].product, 'gemini');
  assert.equal(app.db().users['2'].payment_method, 'uz');
  assert.equal(app.db().users['2'].waiting_receipt, true);
  assert.match(app.replies[0], /Gemini Pro/);
});
