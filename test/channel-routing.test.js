const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { Markup } = require('telegraf');

function setup(product, configured = true, env = {}) {
  let db = { users: { 2: { product: 'android' } }, payments: {
    receipt: { product, user_id: 2, status: 'pending' }
  } };
  const actions = [];
  const hears = [];
  const events = [];
  let startHandler;
  class FakeBot {
    action(pattern, handler) { actions.push({ pattern, handler }); }
    hears(trigger, handler) { hears.push({ trigger, handler }); }
    start(handler) { startHandler = handler; }
    on(event, handler) { events.push({ event, handler }); }
    catch() {}
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
        PRICE_CS16_UZ: '10000 сум', PRICE_CS16_KG: '100 сом' } : {}),
      ...env
    }, once() {} }
  });
  context.module = { exports: {} };
  context.store = {
    async getUser(id) { return { ...db.users[String(id)] }; },
    async setUser(id, patch) { db.users[String(id)] = { ...db.users[String(id)], ...patch }; },
    async getPayment(id) { return db.payments[id] ? { ...db.payments[id], id } : undefined; },
    async createPayment(p) { if (db.payments[p.id]) return false; db.payments[p.id] = { ...p }; return true; },
    async deletePayment(id) { delete db.payments[id]; },
    async markReceiptNotified(id) { db.payments[id].receipt_notified = true; },
    async savePayment(p) { const clean = { ...p }; delete clean._claim; db.payments[p.id] = clean; },
    async claimPayment(id) {
      const p = db.payments[id];
      if (!p || !['pending','rejected'].includes(p.status)) return null;
      const claimed = { ...p, id, _claim: 'test-claim' };
      p.status = 'processing';
      return claimed;
    },
    async releasePayment(p) { await this.savePayment(p); },
    async listPayments(userId, product) { return Object.values(db.payments)
      .filter(p => p.user_id === userId && (!product || p.product === product))
      .sort((a,b) => b.created_at.localeCompare(a.created_at)); }
  };
  vm.runInContext(fs.readFileSync(path.resolve('src/bot.js'), 'utf8') +
    '\nconst { bot, products, productKeyboard, productTitle, mainTitle, mainKeyboard, paymentKeyboard, replyMenuKeyboard, languageKeyboard, splitRequisites } = createBot(process.env, store);', context);
  const channels = [];
  const replies = [];
  const sentMessages = [];
  const editedMessages = [];
  const deletedMessages = [];
  const replyExtras = [];
  const ctx = {
    from: { id: 1 }, match: ['', 'receipt'],
    chat: { id: 1 },
    callbackQuery: { message: { message_id: 99 } },
    message: { message_id: 100 },
    answerCbQuery: async () => {},
    reply: async (text, extra) => {
      replies.push(text);
      replyExtras.push(extra);
      return { message_id: 200 + replies.length };
    },
    deleteMessage: async messageId => deletedMessages.push(messageId),
    editMessageText: async (text, extra) => editedMessages.push({ text, extra }),
    telegram: {
      forwardMessage: async () => {},
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
    action: data => {
      const action = actions.find(item => typeof item.pattern === 'string'
        ? item.pattern === data : item.pattern.test(data));
      ctx.match = typeof action.pattern === 'string' ? null : data.match(action.pattern);
      return action.handler(ctx);
    },
    photo: () => events.find(item => item.event === 'photo').handler(ctx),
    document: () => events.find(item => item.event === 'document').handler(ctx),
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

test('Gemini approval uses the default support contact without creating a channel invite', async () => {
  const app = setup('gemini');
  await app.approve();
  assert.deepEqual(app.channels, []);
  assert.equal(app.db().payments.receipt.status, 'approved');
  assert.match(JSON.stringify(app.sentMessages), /https:\/\/t\.me\/mirzajonows/);
  assert.match(app.sentMessages[0].text, /30 минут/);
  assert.match(app.sentMessages[0].text, /запись экрана/);
  assert.match(app.editedMessages[0].text, /@mirzajonows/);
});

test('Gemini activation instructions follow the chosen Uzbek language', async () => {
  const app = setup('gemini');
  app.db().payments.receipt.lang = 'uz';
  await app.approve();
  assert.match(app.sentMessages[0].text, /30 daqiqa/);
  assert.match(app.sentMessages[0].text, /ekran yozuvini/);
  assert.doesNotMatch(app.sentMessages[0].text, /30 минут/);
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
  const keyboard = JSON.stringify(vm.runInContext('productKeyboard()', app.context));
  assert.match(keyboard, /product_cs16/);
  assert.match(keyboard, /Counter-Strike 1.6 Android/);
  assert.match(
    vm.runInContext("productTitle('ru')", app.context),
    /🎮 GENERALS & CS 1\.6 ANDROID & Gemini Pro/
  );
});

test('menu includes Gemini and all products use the default support account', () => {
  const app = setup('gemini');
  assert.match(JSON.stringify(vm.runInContext('productKeyboard()', app.context)), /product_gemini/);
  assert.match(JSON.stringify(vm.runInContext("mainKeyboard('ru', 'gemini')", app.context)), /https:\/\/t\.me\/mirzajonows/);
  assert.match(JSON.stringify(vm.runInContext("mainKeyboard('ru', 'android')", app.context)), /https:\/\/t\.me\/mirzajonows/);
});

test('Gemini selection shows the complete package for up to 18 months', () => {
  const app = setup('gemini');
  const title = vm.runInContext("mainTitle('ru', 'gemini')", app.context);
  assert.match(title, /до 18 месяцев/);
  for (const product of ['Gemini Pro', 'Google One', 'Nano Banana', '5 TB Google Drive', 'Antigravity', 'Flow']) {
    assert.match(title, new RegExp(product));
  }
});

test('normal navigation has two localized buttons and language choices stay separate', () => {
  const app = setup('android');
  const inlineKeyboard = vm.runInContext("mainKeyboard('ru', 'android').reply_markup.inline_keyboard", app.context);
  const russianMenu = vm.runInContext("replyMenuKeyboard('ru').reply_markup", app.context);
  const uzbekMenu = vm.runInContext("replyMenuKeyboard('uz').reply_markup", app.context);
  const languageChoices = vm.runInContext('languageKeyboard().reply_markup', app.context);
  assert.equal(inlineKeyboard.flat().some(button => button.callback_data?.startsWith('lang_')), false);
  assert.equal(inlineKeyboard.flat().some(button => button.callback_data === 'choose_product'), false);
  assert.equal(russianMenu.resize_keyboard, true);
  assert.equal(russianMenu.is_persistent, true);
  assert.deepEqual(Array.from(russianMenu.keyboard, row => Array.from(row)), [['🛒 Меню товаров'], ['🌐 Изменить язык']]);
  assert.deepEqual(Array.from(uzbekMenu.keyboard, row => Array.from(row)), [['🛒 Mahsulotlar'], ["🌐 Tilni o'zgartirish"]]);
  assert.deepEqual(Array.from(languageChoices.keyboard[0]), ['🇷🇺 Русский', "🇺🇿 O'zbekcha"]);
});

test('/start clears the previous purchase selection', async () => {
  const app = setup('android');
  app.db().users['1'] = { product: 'gemini', payment_method: 'uz', waiting_receipt: true };
  await app.start();
  assert.equal(app.db().users['1'].product, null);
  assert.equal(app.db().users['1'].payment_method, null);
  assert.equal(app.db().users['1'].waiting_receipt, false);
  assert.equal(app.replyExtras[0].reply_markup.is_persistent, true);
  assert.deepEqual(Array.from(app.replyExtras[0].reply_markup.keyboard[0]), ['🇷🇺 Русский', "🇺🇿 O'zbekcha"]);
  assert.equal(app.db().users['1'].language_prompt_message_id, 201);
});

test('choosing a language deletes its prompt and restores localized navigation', async () => {
  const app = setup('android');
  app.db().users['1'] = {
    lang: 'ru', product: 'android', payment_method: 'ru', language_prompt_message_id: 321
  };
  await app.hear("🇺🇿 O'zbekcha");
  assert.equal(app.db().users['1'].lang, 'uz');
  assert.equal(app.db().users['1'].product, 'android');
  assert.equal(app.db().users['1'].language_prompt_message_id, null);
  assert.match(app.replies[0], /O'zbek tili tanlandi/);
  assert.match(app.replies[1], /Qulay to'lov/);
  assert.deepEqual(
    Array.from(app.replyExtras[0].reply_markup.keyboard, row => Array.from(row)),
    [['🛒 Mahsulotlar'], ["🌐 Tilni o'zgartirish"]]
  );
  assert.deepEqual(app.deletedMessages, [100, 321]);
});

test('Change language temporarily shows only Russian and Uzbek choices', async () => {
  const app = setup('android');
  app.db().users['1'] = { lang: 'ru', product: 'android', payment_method: 'ru' };
  await app.hear('🌐 Изменить язык');
  assert.match(app.replies[0], /Выберите язык/);
  assert.deepEqual(Array.from(app.replyExtras[0].reply_markup.keyboard[0]), ['🇷🇺 Русский', "🇺🇿 O'zbekcha"]);
  assert.equal(app.db().users['1'].language_prompt_message_id, 201);
  assert.deepEqual(app.deletedMessages, [100]);

  app.ctx.message.message_id = 101;
  await app.hear("🇺🇿 O'zbekcha");
  assert.equal(app.db().users['1'].lang, 'uz');
  assert.equal(app.db().users['1'].product, 'android');
  assert.equal(app.db().users['1'].language_prompt_message_id, null);
  assert.deepEqual(app.deletedMessages, [100, 101, 201]);
});

test('Product menu cancels unfinished selection and opens all products', async () => {
  const app = setup('gemini');
  app.db().users['1'] = { lang: 'ru', product: 'gemini', payment_method: 'uz', waiting_receipt: true };
  await app.hear('🛒 Меню товаров');
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

const dota2Env = { CHANNEL_DOTA2_ID: '-100333' };

for (const lang of ['ru', 'uz']) {
  test(`Dota 2 catalog and standalone Unity description are localized in ${lang}`, async () => {
    const app = setup('dota2', true, dota2Env);
    app.db().users['1'] = { lang };
    await app.action('product_dota2');
    assert.equal(app.db().users['1'].product, 'dota2');
    const title = app.editedMessages[0].text;
    assert.match(title, /Unity/);
    assert.match(title, /APK/);
    assert.match(title, lang === 'ru' ? /без эмулятора/ : /emulyatorsiz/);
    assert.doesNotMatch(title, /Steam Link|https?:\/\/|официальный порт/);
    const menu = JSON.stringify(vm.runInContext(`productKeyboard('${lang}')`, app.context));
    assert.match(menu, /product_dota2/);
    assert.match(menu, lang === 'ru' ? /Dota 2 на Android/ : /Android uchun Dota 2/);
  });

  for (const [method, amount] of [['ru', '500 ₽'], ['uz', '60 000 сум'], ['kg', '500 сом']]) {
    test(`Dota 2 ${lang}/${method} receipt, status and approval retain the paid product`, async () => {
      const app = setup('dota2', true, dota2Env);
      app.db().users['1'] = { lang, product: 'dota2' };
      await app.action('choose_payment');
      assert.match(JSON.stringify(app.replyExtras.at(-1)), new RegExp(`pay_dota2_${method}`));
      await app.action(`pay_dota2_${method}`);
      assert.ok(app.replies.at(-1).includes(amount));
      await app.action('send_receipt');
      assert.equal(app.db().users['1'].waiting_receipt, true);
      if (method === 'uz') {
        app.ctx.message.document = { mime_type: 'application/pdf' };
        await app.document();
      } else {
        await app.photo();
      }
      const payment = Object.values(app.db().payments).find(p => p.id);
      assert.equal(payment.product, 'dota2');
      assert.equal(payment.price, amount);
      assert.equal(payment.lang, lang);
      assert.equal(payment.status, 'pending');
      assert.equal(app.db().users['1'].waiting_receipt, false);
      assert.ok(app.sentMessages.some(m => m.text.includes(amount)));
      await app.status();
      assert.match(app.replies.at(-1), lang === 'ru' ? /На проверке/ : /Tekshiruvda/);
      app.db().users['1'].product = 'android';
      await app.action(`approve:${payment.id}`);
      assert.deepEqual(app.channels, ['-100333']);
      assert.equal(app.db().payments[payment.id].status, 'approved');
      assert.match(app.sentMessages.at(-1).text, lang === 'ru' ? /Оплата подтверждена/ : /To'lov tasdiqlandi/);
    });
  }
}

test('Dota 2 rejection and retry restore its payment selection', async () => {
  const app = setup('dota2', true, dota2Env);
  Object.assign(app.db().payments.receipt, { payment_method: 'kg', price: '600 сом', lang: 'uz' });
  await app.reject();
  assert.equal(app.db().payments.receipt.status, 'rejected');
  app.ctx.from.id = 2;
  await app.retry();
  assert.equal(app.db().users['2'].product, 'dota2');
  assert.equal(app.db().users['2'].payment_method, 'kg');
  assert.equal(app.db().users['2'].waiting_receipt, true);
});

for (const channel of ['', '-123', 'not-a-channel']) {
  test(`Dota 2 without a valid dedicated channel (${channel}) cannot accept payment or deliver access`, async () => {
    const app = setup('dota2', true, { CHANNEL_DOTA2_ID: channel });
    const keyboard = JSON.stringify(vm.runInContext("mainKeyboard('ru', 'dota2')", app.context));
    assert.doesNotMatch(keyboard, /choose_payment|send_receipt/);
    assert.match(keyboard, /status/);
    assert.match(vm.runInContext("mainTitle('ru', 'dota2')", app.context), /пока недоступна/);
    app.db().users['1'] = { lang: 'uz', product: 'dota2', payment_method: 'ru', waiting_receipt: true };
    for (const data of ['choose_payment', 'pay_dota2_ru', 'pay_ru', 'send_receipt']) {
      await app.action(data);
      assert.match(app.replies.at(-1), /hozircha mavjud emas/);
      assert.equal(app.db().users['1'].waiting_receipt, false);
      assert.equal(app.db().users['1'].payment_method, null);
    }
    app.db().users['1'].waiting_receipt = true;
    await app.photo();
    assert.equal(Object.keys(app.db().payments).length, 1);
    await app.action('approve:receipt');
    assert.equal(app.db().payments.receipt.status, 'pending');
    assert.deepEqual(app.channels, []);
    Object.assign(app.db().payments.receipt, { status: 'rejected', payment_method: 'ru' });
    app.ctx.from.id = 2;
    await app.action('retry:receipt');
    assert.equal(app.db().users['2'].waiting_receipt, false);
  });
}

test('Dota 2 honors price and UZ requisites overrides without changing other products', async () => {
  const app = setup('dota2', true, { ...dota2Env, PRICE_DOTA2_UZ: '90 000 сум', PAYMENT_UZ_DOTA2: '9999 8888 7777 6666|Dota Owner' });
  await app.action('pay_dota2_uz');
  assert.match(app.replies.at(-1), /90 000 сум/);
  assert.match(app.replies.at(-1), /9999 8888 7777 6666/);
  assert.equal(vm.runInContext('products.android.prices.uz.amount', app.context), '50 000 сум');
});

test('Dota 2 invite failure leaves the receipt pending for retry', async () => {
  const app = setup('dota2', true, dota2Env);
  app.ctx.telegram.createChatInviteLink = async () => {
    const error = new Error('missing invite permission');
    error.response = { error_code: 403 };
    throw error;
  };
  await app.approve();
  assert.equal(app.db().payments.receipt.status, 'pending');
  assert.match(app.replies.at(-1), /Проверьте права бота/);
});

test('Dota 2 uses the owner-provided channel and prices by default', async () => {
  const app = setup('dota2');
  await app.approve();
  assert.deepEqual(app.channels, ['-1004334193236']);
  assert.equal(vm.runInContext('products.dota2.prices.ru.amount', app.context), '500 ₽');
  assert.equal(vm.runInContext('products.dota2.prices.uz.amount', app.context), '60 000 сум');
  assert.equal(vm.runInContext('products.dota2.prices.kg.amount', app.context), '500 сом');
});

test('an uncertain invite result stays claimed instead of creating another invitation', async () => {
  const app = setup('dota2', true, dota2Env);
  app.ctx.telegram.createChatInviteLink = async () => { throw new Error('timeout'); };
  await app.approve();
  assert.equal(app.db().payments.receipt.status, 'processing');
  assert.match(app.replies.at(-1), /Результат создания приглашения неизвестен/);
  await app.approve();
  assert.match(app.replies.at(-1), /уже обрабатывается/);
});
