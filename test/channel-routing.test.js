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
  class FakeBot {
    action(pattern, handler) { actions.push({ pattern, handler }); }
    start() {} on() {} catch() {}
    launch() { return Promise.resolve(); }
  }
  const context = vm.createContext({
    require(name) {
      if (name === 'dotenv') return { config() {} };
      if (name === 'telegraf') return { Telegraf: FakeBot, Markup };
      if (name === 'fs') return {
        readFileSync: () => JSON.stringify(db),
        writeFileSync: (_, value) => { db = JSON.parse(value); }
      };
      return require(name);
    },
    __dirname: path.resolve('src'), console,
    process: { env: {
      BOT_TOKEN: 'test', ADMIN_ID: '1', CHANNEL_ID: '-100111',
      ...(configured ? { CHANNEL_CS16_ID: '-100222', PRICE_CS16_RU: '100 ₽',
        PRICE_CS16_UZ: '10000 сум', PRICE_CS16_KG: '100 сом' } : {})
    }, once() {} }
  });
  vm.runInContext(fs.readFileSync(path.resolve('src/index.js'), 'utf8'), context);
  const channels = [];
  const replies = [];
  const sentMessages = [];
  const editedMessages = [];
  const ctx = {
    from: { id: 1 }, match: ['', 'receipt'],
    answerCbQuery: async () => {}, reply: async text => replies.push(text),
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
  return { context, channels, replies, sentMessages, editedMessages, db: () => db,
    approve: () => actions.find(a => String(a.pattern).includes('approve:')).handler(ctx) };
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

test('main menu has inline language buttons and no switch-product button', () => {
  const app = setup('android');
  const keyboard = vm.runInContext("mainKeyboard('ru', 'android').reply_markup.inline_keyboard", app.context);
  assert.ok(keyboard.some(row => row.length === 2 &&
    row[0].callback_data === 'lang_ru' && row[1].callback_data === 'lang_uz'));
  assert.equal(keyboard.flat().some(button => button.callback_data === 'choose_product'), false);
  assert.equal(keyboard.flat().some(button => button.callback_data === 'language'), false);
});
