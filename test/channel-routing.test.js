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
  const ctx = {
    from: { id: 1 }, match: ['', 'receipt'],
    answerCbQuery: async () => {}, reply: async text => replies.push(text),
    editMessageText: async () => {},
    telegram: {
      createChatInviteLink: async (channel, options) => {
        channels.push(channel);
        assert.equal(options.member_limit, 1);
        return { invite_link: 'https://t.me/+test' };
      },
      sendMessage: async () => {}
    }
  };
  return { context, channels, replies, db: () => db,
    approve: () => actions.find(a => String(a.pattern).includes('approve:')).handler(ctx) };
}

for (const product of ['cs16', 'android', 'iphone', 'gemini', undefined]) {
  test(`approval routes ${product || 'legacy payment'} to its channel`, async () => {
    const app = setup(product);
    await app.approve();
    assert.deepEqual(app.channels, [product === 'cs16' ? '-100222' : '-100111']);
    assert.equal(app.db().payments.receipt.status, 'approved');
  });
}

test('missing CS channel blocks approval without falling back to Generals', async () => {
  const app = setup('cs16', false);
  await app.approve();
  assert.deepEqual(app.channels, []);
  assert.equal(app.db().payments.receipt.status, 'pending');
  assert.match(app.replies[0], /CHANNEL_CS16_ID/);
  assert.equal(vm.runInContext("isProductReady('cs16')", app.context), false);
  assert.equal(vm.runInContext("isProductReady('android')", app.context), true);
});

test('menu includes CS and configured prices enable payment', () => {
  const app = setup('cs16');
  assert.equal(vm.runInContext("isProductReady('cs16')", app.context), true);
  assert.match(JSON.stringify(vm.runInContext('productKeyboard()', app.context)), /product_cs16/);
  assert.match(
    vm.runInContext("productTitle('ru')", app.context),
    /🎮 GENERALS & CS 1\.6 ANDROID & Gemini Pro/
  );
});
