require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const ADMIN_USERNAME = normalizeUsername(process.env.ADMIN_USERNAME || '');
const DEFAULT_SUPPORT_USERNAME = normalizeUsername(process.env.DEFAULT_SUPPORT_USERNAME || ADMIN_USERNAME || 'mirzajonows');
const GEMINI_SUPPORT_USERNAME = normalizeUsername(process.env.GEMINI_SUPPORT_USERNAME || 'bahriddindev');
const CHANNEL_ID = process.env.CHANNEL_ID;
const CHANNEL_CS16_ID = process.env.CHANNEL_CS16_ID || '-1004335642053';
const INVITE_EXPIRE_MINUTES = Number(process.env.INVITE_EXPIRE_MINUTES || 60);
const BOT_HEADING = '🎮 GENERALS & CS 1.6 ANDROID & Gemini Pro';

const countryNames = {
  ru: '🇷🇺 Россия',
  uz: "🇺🇿 O'zbekiston",
  kg: '🇰🇬 Кыргызстан'
};

// RU/KG requisites are shared across all products. UZ requisites are split per product group.
const PAYMENT_RU = process.env.PAYMENT_RU || 'Реквизиты не указаны';
const PAYMENT_KG = process.env.PAYMENT_KG || 'Реквизиттер көрсөтүлгөн эмес';
const PAYMENT_UZ_ANDROID = process.env.PAYMENT_UZ_ANDROID || "Rekvizitlar ko'rsatilmagan";
const PAYMENT_UZ_GEMINI = process.env.PAYMENT_UZ_GEMINI || "Rekvizitlar ko'rsatilmagan";

const products = {
  cs16: {
    name: '🎯 Counter-Strike 1.6',
    prices: {
      ru: { amount: process.env.PRICE_CS16_RU || '700 ₽', requisites: PAYMENT_RU },
      uz: { amount: process.env.PRICE_CS16_UZ || '50 000 сум', requisites: process.env.PAYMENT_UZ_CS16 || PAYMENT_UZ_ANDROID },
      kg: { amount: process.env.PRICE_CS16_KG || '500 сом', requisites: PAYMENT_KG }
    }
  },
  android: {
    name: '🎮 Generals Android',
    prices: {
      ru: { amount: process.env.PRICE_ANDROID_RU || '500 ₽', requisites: PAYMENT_RU },
      uz: { amount: process.env.PRICE_ANDROID_UZ || '50 000 сум', requisites: PAYMENT_UZ_ANDROID },
      kg: { amount: process.env.PRICE_ANDROID_KG || '500 сом', requisites: PAYMENT_KG }
    }
  },
  iphone: {
    name: '🎮 Generals iPhone',
    prices: {
      ru: { amount: process.env.PRICE_IPHONE_RU || '1000 ₽', requisites: PAYMENT_RU },
      uz: { amount: process.env.PRICE_IPHONE_UZ || '80 000 сум', requisites: PAYMENT_UZ_ANDROID },
      kg: { amount: process.env.PRICE_IPHONE_KG || '700 сом', requisites: PAYMENT_KG }
    }
  },
  gemini: {
    name: '🤖 Gemini Pro',
    prices: {
      ru: { amount: process.env.PRICE_GEMINI_RU || '500 ₽', requisites: PAYMENT_RU },
      uz: { amount: process.env.PRICE_GEMINI_UZ || '50 000 сум', requisites: PAYMENT_UZ_GEMINI },
      kg: { amount: process.env.PRICE_GEMINI_KG || '500 сом', requisites: PAYMENT_KG }
    }
  }
};

if (!BOT_TOKEN || BOT_TOKEN.includes('PASTE_') || BOT_TOKEN === 'your_bot_token') {
  throw new Error('Укажите BOT_TOKEN в .env');
}
if (!Number.isSafeInteger(ADMIN_ID) || ADMIN_ID <= 0) throw new Error('Укажите корректный ADMIN_ID в .env');
for (const [key, channelId] of Object.entries({ CHANNEL_ID, CHANNEL_CS16_ID })) {
  if (!/^-100\d+$/.test(channelId || '')) throw new Error(`Укажите корректный ${key} в .env`);
}
const missingPaymentConfig = [
  'PAYMENT_RU',
  'PAYMENT_KG',
  'PAYMENT_UZ_ANDROID',
  'PAYMENT_UZ_GEMINI'
].filter(key => !process.env[key]);
if (missingPaymentConfig.length) {
  throw new Error(`Укажите реквизиты в .env: ${missingPaymentConfig.join(', ')}`);
}
if (!Number.isInteger(INVITE_EXPIRE_MINUTES) || INVITE_EXPIRE_MINUTES <= 0) {
  throw new Error('INVITE_EXPIRE_MINUTES должен быть положительным целым числом');
}
for (const [key, username] of Object.entries({ DEFAULT_SUPPORT_USERNAME, GEMINI_SUPPORT_USERNAME })) {
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    throw new Error(`${key} содержит некорректный Telegram username`);
  }
}

const bot = new Telegraf(BOT_TOKEN);
const DB_PATH = process.env.DATA_PATH || path.join(__dirname, '..', 'data.json');

function normalizeUsername(username) {
  return username.trim().replace(/^@+/, '');
}

async function safeAnswer(ctx, text) {
  try {
    await ctx.answerCbQuery(text);
  } catch (err) {
    const code = err && err.response && err.response.error_code;
    // ignore common harmless callback errors
    if (code === 400 || code === 403) return;
    console.error('CB ERROR:', err);
  }
}

async function safeDeleteCallbackMessage(ctx) {
  const messageId = ctx.callbackQuery && ctx.callbackQuery.message && ctx.callbackQuery.message.message_id;
  if (!messageId || typeof ctx.deleteMessage !== 'function') return;
  try {
    await ctx.deleteMessage(messageId);
  } catch (err) {
    const code = err && err.response && err.response.error_code;
    if (code !== 400 && code !== 403) console.error('DELETE MESSAGE ERROR:', err);
  }
}

async function replyAndRemovePrevious(ctx, text, extra) {
  const message = await ctx.reply(text, extra);
  await safeDeleteCallbackMessage(ctx);
  return message;
}

function loadDb() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return {
      users: db.users && typeof db.users === 'object' ? db.users : {},
      payments: db.payments && typeof db.payments === 'object' ? db.payments : {}
    };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { users: {}, payments: {} };
    throw new Error(`Не удалось прочитать базу ${DB_PATH}: ${err.message}`);
  }
}
function saveDb(db) {
  const tempPath = `${DB_PATH}.${process.pid || 'bot'}.tmp`;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, DB_PATH);
}
function getUser(id) {
  const db = loadDb();
  return db.users[String(id)] || {};
}
function setUser(id, patch) {
  const db = loadDb();
  db.users[String(id)] = { ...(db.users[String(id)] || {}), ...patch };
  saveDb(db);
}
function tr(lang, ru, uz) {
  return lang === 'uz' ? uz : ru;
}

function escapeHtml(str) {
  return (str || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function splitRequisites(requisites) {
  const value = (requisites || '').trim();
  if (value.includes('|')) {
    const [number, ...label] = value.split('|');
    return { number: number.trim(), label: label.join('|').trim() };
  }

  const parts = value.split(/\s+/).filter(Boolean);
  if (!parts.length) return { number: '', label: '' };
  let count = 1;
  if (!parts[0].startsWith('+')) {
    while (count < parts.length && /^\d+$/.test(parts[count])) count += 1;
  }
  return { number: parts.slice(0, count).join(' '), label: parts.slice(count).join(' ') };
}

function profileBlock(record) {
  const uname = record.username ? `@${record.username}` : 'без username';
  const profileLink = record.username ? `https://t.me/${record.username}` : `tg://user?id=${record.user_id}`;
  return `👤 ${escapeHtml(record.first_name)} (${uname})\n🔗 <a href="${profileLink}">Профиль</a>\n🆔 ${record.user_id}`;
}

function languageKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🇷🇺 Русский', 'lang_ru'),
      Markup.button.callback("🇺🇿 O'zbekcha", 'lang_uz')
    ]
  ]);
}

function productKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(products.android.name, 'product_android')],
    [Markup.button.callback(products.cs16.name, 'product_cs16')],
    [Markup.button.callback(products.gemini.name, 'product_gemini')]
    // iPhone temporarily hidden — not working yet
  ]);
}

function productTitle(lang) {
  return tr(
    lang,
    `${BOT_HEADING}\n\nЧто хотите приобрести?`,
    `${BOT_HEADING}\n\nNimani sotib olmoqchisiz?`
  );
}

function mainTitle(lang, productCode) {
  const product = products[productCode];
  const deliveryText = productCode === 'gemini'
    ? tr(
      lang,
      '✅ После проверки администратором бот подтвердит оплату. Для получения Gemini Pro обратитесь в поддержку.',
      "✅ Administrator tekshirganidan so'ng bot to'lovni tasdiqlaydi. Gemini Pro olish uchun yordam xizmatiga murojaat qiling."
    )
    : tr(
      lang,
      '✅ После проверки администратором бот сам выдаст доступ в закрытый канал.',
      "✅ Administrator tekshirganidan so'ng bot yopiq kanalga kirish havolasini beradi."
    );
  return tr(
    lang,
    `🎮 *${product.name}*\n\nВыберите удобный способ оплаты и после оплаты отправьте чек.\n\n${deliveryText}`,
    `🎮 *${product.name}*\n\nQulay to'lov turini tanlang va to'lovdan keyin chekni yuboring.\n\n${deliveryText}`
  );
}

function mainKeyboard(lang, productCode) {
  const supportUsername = productCode === 'gemini' ? GEMINI_SUPPORT_USERNAME : DEFAULT_SUPPORT_USERNAME;
  const supportLink = `https://t.me/${supportUsername}`;
  return Markup.inlineKeyboard([
    [Markup.button.callback(tr(lang, '💳 Оплатить доступ', "💳 To'lov qilish"), 'choose_payment')],
    [Markup.button.callback(tr(lang, '📸 Отправить чек', '📸 Chek yuborish'), 'send_receipt')],
    [Markup.button.callback(tr(lang, '✅ Статус оплаты', "✅ To'lov holati"), 'status')],
    [
      Markup.button.callback('🇷🇺 Русский', 'lang_ru'),
      Markup.button.callback("🇺🇿 O'zbekcha", 'lang_uz')
    ],
    [Markup.button.url(tr(lang, '🆘 Поддержка', "🆘 Yordam"), supportLink)]
  ]);
}

function paymentKeyboard(lang, productCode) {
  const product = products[productCode];
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${countryNames.ru} ${product.prices.ru.amount}`, `pay_${productCode}_ru`)],
    [Markup.button.callback(`${countryNames.uz} ${product.prices.uz.amount}`, `pay_${productCode}_uz`)],
    [Markup.button.callback(`${countryNames.kg} ${product.prices.kg.amount}`, `pay_${productCode}_kg`)],
    [Markup.button.callback(tr(lang, '⬅️ Назад', '⬅️ Orqaga'), 'home')]
  ]);
}

bot.start(async (ctx) => {
  setUser(ctx.from.id, {
    username: ctx.from.username || '',
    first_name: ctx.from.first_name || '',
    last_seen: new Date().toISOString(),
    product: null,
    payment_method: null,
    waiting_receipt: false
  });
  await ctx.reply(`${BOT_HEADING}\n\nВыберите язык / Tilni tanlang:`, languageKeyboard());
});

bot.action('language', async (ctx) => {
  await safeAnswer(ctx);
  await ctx.editMessageText('Выберите язык / Tilni tanlang:', languageKeyboard());
});

bot.action(/^lang_(ru|uz)$/, async (ctx) => {
  await safeAnswer(ctx);
  const lang = ctx.match[1];
  const user = getUser(ctx.from.id);
  setUser(ctx.from.id, { lang });
  if (user.product && products[user.product]) {
    return ctx.editMessageText(
      mainTitle(lang, user.product),
      { parse_mode: 'Markdown', ...mainKeyboard(lang, user.product) }
    );
  }
  await ctx.editMessageText(productTitle(lang), productKeyboard());
});

bot.action('choose_product', async (ctx) => {
  await safeAnswer(ctx);
  const lang = getUser(ctx.from.id).lang || 'ru';
  await ctx.editMessageText(productTitle(lang), productKeyboard());
});

bot.action(/^product_(android|iphone|gemini|cs16)$/, async (ctx) => {
  await safeAnswer(ctx);
  const productCode = ctx.match[1];
  const lang = getUser(ctx.from.id).lang || 'ru';
  setUser(ctx.from.id, { product: productCode, payment_method: null, waiting_receipt: false });
  await ctx.editMessageText(mainTitle(lang, productCode), { parse_mode: 'Markdown', ...mainKeyboard(lang, productCode) });
});

bot.action('home', async (ctx) => {
  await safeAnswer(ctx);
  const user = getUser(ctx.from.id);
  const lang = user.lang || 'ru';

  if (!user.product || !products[user.product]) {
    return ctx.editMessageText(productTitle(lang), productKeyboard());
  }
  await ctx.editMessageText(mainTitle(lang, user.product), { parse_mode: 'Markdown', ...mainKeyboard(lang, user.product) });
});

bot.action('choose_payment', async (ctx) => {
  await safeAnswer(ctx);
  const user = getUser(ctx.from.id);
  const lang = user.lang || 'ru';

  if (!user.product || !products[user.product]) {
    return replyAndRemovePrevious(
      ctx,
      tr(lang, 'Сначала выберите товар.', 'Avval mahsulotni tanlang.'),
      productKeyboard()
    );
  }

  await replyAndRemovePrevious(
    ctx,
    tr(
      lang,
      '💳 Выберите страну / валюту для оплаты:',
      "💳 To'lov uchun davlat / valyutani tanlang:"
    ),
    paymentKeyboard(lang, user.product)
  );
});

async function selectPayment(ctx, productCode, methodCode) {
  await safeAnswer(ctx);
  const user = getUser(ctx.from.id);
  const lang = user.lang || 'ru';

  if (!productCode || !products[productCode]) {
    return replyAndRemovePrevious(
      ctx,
      tr(lang, 'Сначала выберите товар.', 'Avval mahsulotni tanlang.'),
      productKeyboard()
    );
  }

  const product = products[productCode];
  const price = product.prices[methodCode];
  const { number: requisitesNumber, label: requisitesLabel } = splitRequisites(price.requisites);

  setUser(ctx.from.id, {
    product: productCode,
    payment_method: methodCode,
    waiting_receipt: false
  });

  await replyAndRemovePrevious(
    ctx,
    tr(
      lang,
      `💳 *Оплата доступа*\n\n📦 ${product.name}\n${countryNames[methodCode]}\nСумма: *${price.amount}*\n\nРеквизиты (нажмите, чтобы скопировать):\n\`${requisitesNumber}\` ${requisitesLabel}\n\nПосле оплаты нажмите «📸 Отправить чек».`,
      `💳 *Kirish uchun to'lov*\n\n📦 ${product.name}\n${countryNames[methodCode]}\nSumma: *${price.amount}*\n\nRekvizitlar (nusxalash uchun bosing):\n\`${requisitesNumber}\` ${requisitesLabel}\n\nTo'lovdan so'ng «📸 Chek yuborish» tugmasini bosing.`
    ),
    { parse_mode: 'Markdown', ...mainKeyboard(lang, productCode) }
  );
}

bot.action(/^pay_(android|iphone|gemini|cs16)_(ru|uz|kg)$/, async (ctx) => {
  return selectPayment(ctx, ctx.match[1], ctx.match[2]);
});

// Keep old messages with pre-product callback data functional.
bot.action(/^pay_(ru|uz|kg)$/, async (ctx) => {
  const user = getUser(ctx.from.id);
  return selectPayment(ctx, user.product, ctx.match[1]);
});

bot.action('send_receipt', async (ctx) => {
  await safeAnswer(ctx);
  const user = getUser(ctx.from.id);
  const lang = user.lang || 'ru';

  if (!user.product || !products[user.product] || !user.payment_method) {
    return replyAndRemovePrevious(
      ctx,
      tr(lang, 'Сначала выберите способ оплаты.', "Avval to'lov usulini tanlang."),
      user.product ? paymentKeyboard(lang, user.product) : productKeyboard()
    );
  }

  setUser(ctx.from.id, { waiting_receipt: true });

  const product = products[user.product];
  const price = product.prices[user.payment_method];

  await replyAndRemovePrevious(
    ctx,
    tr(
      lang,
      `📸 Отправьте фото или PDF чека.\n\nТовар: ${product.name}\nОплата: ${countryNames[user.payment_method]} — ${price.amount}`,
      `📸 Chek rasmi yoki PDF faylini yuboring.\n\nMahsulot: ${product.name}\nTo'lov: ${countryNames[user.payment_method]} — ${price.amount}`
    )
  );
});

async function acceptReceipt(ctx) {
  const user = getUser(ctx.from.id);
  const lang = user.lang || 'ru';

  if (!user.waiting_receipt || !user.product || !products[user.product] || !user.payment_method) {
    return ctx.reply(
      tr(lang, 'Сначала выберите оплату и нажмите «📸 Отправить чек».', "Avval to'lovni tanlang va «📸 Chek yuborish» tugmasini bosing."),
      mainKeyboard(lang, user.product)
    );
  }

  const product = products[user.product];
  const price = product.prices[user.payment_method];
  const db = loadDb();
  const paymentId = `${Date.now()}_${ctx.from.id}`;

  db.payments[paymentId] = {
    id: paymentId,
    user_id: ctx.from.id,
    username: ctx.from.username || '',
    first_name: ctx.from.first_name || '',
    lang,
    product: user.product,
    product_name: product.name,
    payment_method: user.payment_method,
    price: price.amount,
    country: countryNames[user.payment_method],
    status: 'pending',
    created_at: new Date().toISOString(),
    source_chat_id: ctx.chat.id,
    source_message_id: ctx.message.message_id
  };
  db.users[String(ctx.from.id)] = {
    ...(db.users[String(ctx.from.id)] || {}),
    waiting_receipt: false
  };
  saveDb(db);

  try {
    await ctx.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
    await ctx.telegram.sendMessage(
      ADMIN_ID,
      `🧾 Новый чек\n\n${profileBlock(db.payments[paymentId])}\n📦 ${product.name}\n🌍 ${countryNames[user.payment_method]}\n💳 ${price.amount}\n\nПодтвердить оплату?`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Подтвердить', `approve:${paymentId}`),
          Markup.button.callback('❌ Отклонить', `reject:${paymentId}`)
        ]
      ]) }
    );
  } catch (err) {
    console.error('ADMIN DELIVERY ERROR:', err);
    delete db.payments[paymentId];
    db.users[String(ctx.from.id)].waiting_receipt = true;
    saveDb(db);
    return ctx.reply(
      tr(
        lang,
        '❗ Не удалось отправить чек администратору. Попробуйте отправить его ещё раз или обратитесь в поддержку.',
        "❗ Chekni administratorga yuborib bo'lmadi. Uni qayta yuboring yoki yordam xizmatiga murojaat qiling."
      ),
      mainKeyboard(lang, user.product)
    );
  }

  const receiptConfirmation = user.product === 'gemini'
    ? tr(
      lang,
      '✅ Чек получен!\n\nОжидайте проверки. После подтверждения обратитесь в поддержку для получения Gemini Pro.',
      "✅ Chek qabul qilindi!\n\nTekshiruvni kuting. Tasdiqlangach Gemini Pro olish uchun yordam xizmatiga murojaat qiling."
    )
    : tr(
      lang,
      '✅ Чек получен!\n\nОжидайте проверки. После подтверждения бот автоматически отправит ссылку в закрытый канал.',
      "✅ Chek qabul qilindi!\n\nTekshiruvni kuting. Tasdiqlangach bot yopiq kanal havolasini avtomatik yuboradi."
    );
  await ctx.reply(receiptConfirmation, mainKeyboard(lang, user.product));
}

bot.on('photo', acceptReceipt);

bot.on('document', async (ctx) => {
  const mime = ctx.message.document?.mime_type || '';
  if (mime.startsWith('image/') || mime === 'application/pdf') return acceptReceipt(ctx);

  const lang = getUser(ctx.from.id).lang || 'ru';
  await ctx.reply(tr(lang, 'Отправьте фото или PDF чека.', 'Chek rasmi yoki PDF faylini yuboring.'));
});

bot.action(/^approve:(.+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return safeAnswer(ctx, 'Нет доступа');
  await safeAnswer(ctx, 'Подтверждаю…');

  const paymentId = ctx.match[1];
  const db = loadDb();
  const payment = db.payments[paymentId];

  if (!payment) return ctx.reply('Платёж не найден.');
  if (payment.status === 'approved') return ctx.reply('Уже подтверждено.');

  const lang = payment.lang || 'ru';
  const productLine = payment.product_name ? `📦 ${payment.product_name}\n` : '';

  if (payment.product === 'gemini') {
    payment.status = 'approved';
    payment.approved_at = new Date().toISOString();
    delete payment.rejected_at;
    saveDb(db);

    let delivered = true;
    try {
      await ctx.telegram.sendMessage(
        payment.user_id,
        tr(
          lang,
          `✅ *Оплата подтверждена!*\n\n${productLine}${payment.country} — ${payment.price}\n\nДля получения Gemini Pro напишите в поддержку.`,
          `✅ *To'lov tasdiqlandi!*\n\n${productLine}${payment.country} — ${payment.price}\n\nGemini Pro olish uchun yordam xizmatiga yozing.`
        ),
        { parse_mode: 'Markdown', ...mainKeyboard(lang, 'gemini') }
      );
    } catch (err) {
      delivered = false;
      console.error('DELIVERY ERROR:', err);
    }
    const deliveryLine = delivered
      ? `Пользователю отправлен контакт @${GEMINI_SUPPORT_USERNAME}.`
      : 'Уведомление не доставлено пользователю. Свяжитесь с ним вручную.';
    await ctx.editMessageText(
      `✅ ОПЛАТА GEMINI PRO ПОДТВЕРЖДЕНА\n\n${profileBlock(payment)}\n${productLine}${payment.country} — ${payment.price}\n${deliveryLine}`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Resolve from the paid product, never the user's current menu selection.
  const channelId = payment.product === 'cs16' ? CHANNEL_CS16_ID : CHANNEL_ID;

  const expireDate = Math.floor(Date.now() / 1000) + INVITE_EXPIRE_MINUTES * 60;

  let invite;
  try {
    invite = await ctx.telegram.createChatInviteLink(channelId, {
      name: `pay_${payment.user_id}`,
      expire_date: expireDate,
      member_limit: 1
    });
  } catch (err) {
    console.error(err);
    return ctx.reply('❗ Не удалось создать ссылку. Проверьте права бота в закрытом канале.');
  }

  payment.status = 'approved';
  payment.approved_at = new Date().toISOString();
  payment.invite_link = invite.invite_link;
  delete payment.rejected_at;
  saveDb(db);

  let delivered = true;
  try {
    await ctx.telegram.sendMessage(
      payment.user_id,
      tr(
        lang,
        `✅ *Оплата подтверждена!*\n\n${productLine}${payment.country} — ${payment.price}\n\nНажмите кнопку ниже, чтобы войти в закрытый канал.\n\n⚠️ Ссылка одноразовая и действует ${INVITE_EXPIRE_MINUTES} минут.`,
        `✅ *To'lov tasdiqlandi!*\n\n${productLine}${payment.country} — ${payment.price}\n\nYopiq kanalga kirish uchun pastdagi tugmani bosing.\n\n⚠️ Havola bir martalik va ${INVITE_EXPIRE_MINUTES} daqiqa amal qiladi.`
      ),
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url(tr(lang, '🔐 Войти в канал', '🔐 Kanalga kirish'), invite.invite_link)]
        ])
      }
    );

  } catch (err) {
    delivered = false;
    console.error('DELIVERY ERROR:', err);
  }
  const deliveryLine = delivered
    ? 'Ссылка отправлена пользователю.'
    : `Ссылка не доставлена пользователю. Перешлите её вручную:\n${invite.invite_link}`;
  await ctx.editMessageText(
    `✅ ОПЛАТА ПОДТВЕРЖДЕНА\n\n${profileBlock(payment)}\n${productLine}${payment.country} — ${payment.price}\n${deliveryLine}`,
    { parse_mode: 'HTML' }
  );
});

bot.action(/^retry:(.+)$/, async (ctx) => {
  await safeAnswer(ctx);
  const paymentId = ctx.match[1];
  const db = loadDb();
  const payment = db.payments[paymentId];
  const lang = getUser(ctx.from.id).lang || payment?.lang || 'ru';

  if (!payment || payment.user_id !== ctx.from.id) {
    return replyAndRemovePrevious(ctx, tr(lang, 'Платёж не найден.', "To'lov topilmadi."));
  }
  if (payment.status !== 'rejected' || !products[payment.product] || !countryNames[payment.payment_method]) {
    return replyAndRemovePrevious(ctx, tr(lang, 'Этот чек нельзя отправить повторно.', "Bu chekni qayta yuborib bo'lmaydi."));
  }

  setUser(ctx.from.id, {
    product: payment.product,
    payment_method: payment.payment_method,
    waiting_receipt: true
  });
  await replyAndRemovePrevious(
    ctx,
    tr(
      lang,
      `📸 Отправьте новое фото или PDF чека.\n\nТовар: ${payment.product_name}\nОплата: ${payment.country} — ${payment.price}`,
      `📸 Chekning yangi rasmi yoki PDF faylini yuboring.\n\nMahsulot: ${payment.product_name}\nTo'lov: ${payment.country} — ${payment.price}`
    )
  );
});

bot.action(/^reject:(.+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return safeAnswer(ctx, 'Нет доступа');
  await safeAnswer(ctx, 'Отклонено');

  const paymentId = ctx.match[1];
  const db = loadDb();
  const payment = db.payments[paymentId];

  if (!payment) return ctx.reply('Платёж не найден.');
  if (payment.status === 'approved') return ctx.reply('Нельзя отклонить уже подтверждённую оплату.');
  if (payment.status === 'rejected') return ctx.reply('Уже отклонено.');

  payment.status = 'rejected';
  payment.rejected_at = new Date().toISOString();
  saveDb(db);

  const lang = payment.lang || 'ru';
  const productLine = payment.product_name ? `📦 ${payment.product_name}\n` : '';
  let delivered = true;
  try {
    await ctx.telegram.sendMessage(
      payment.user_id,
      tr(
        lang,
        '❌ Оплата не подтверждена.\n\nПроверьте чек и реквизиты. Если была ошибка, нажмите кнопку ниже и отправьте новый чек.',
        "❌ To'lov tasdiqlanmadi.\n\nChek va rekvizitlarni tekshiring. Xatolik bo'lsa, quyidagi tugmani bosib yangi chek yuboring."
      ),
      Markup.inlineKeyboard([
        [Markup.button.callback(tr(lang, '📸 Отправить чек повторно', '📸 Chekni qayta yuborish'), `retry:${paymentId}`)],
        [Markup.button.url(
          tr(lang, '🆘 Поддержка', '🆘 Yordam'),
          `https://t.me/${payment.product === 'gemini' ? GEMINI_SUPPORT_USERNAME : DEFAULT_SUPPORT_USERNAME}`
        )]
      ])
    );
  } catch (err) {
    delivered = false;
    console.error('DELIVERY ERROR:', err);
  }

  await ctx.editMessageText(
    `❌ ОПЛАТА ОТКЛОНЕНА\n\n${profileBlock(payment)}\n${productLine}${payment.country} — ${payment.price}${delivered ? '' : '\nУведомление не доставлено пользователю.'}`,
    { parse_mode: 'HTML' }
  );
});

bot.action('status', async (ctx) => {
  await safeAnswer(ctx);
  const user = getUser(ctx.from.id);
  const lang = user.lang || 'ru';
  const db = loadDb();

  const payments = Object.values(db.payments)
    .filter(p => p.user_id === ctx.from.id && (!user.product || p.product === user.product))
    .sort((a,b) => b.created_at.localeCompare(a.created_at));

  if (!payments.length) {
    const productName = user.product && products[user.product] ? products[user.product].name : '';
    return replyAndRemovePrevious(
      ctx,
      tr(
        lang,
        productName ? `У вас пока нет отправленных чеков для ${productName}.` : 'У вас пока нет отправленных чеков.',
        `${productName || 'Bu mahsulot'} uchun hali chek yubormagansiz.`
      ),
      mainKeyboard(lang, user.product)
    );
  }

  const p = payments[0];
  const statusMap = {
    pending: tr(lang, '⏳ На проверке', '⏳ Tekshiruvda'),
    approved: tr(lang, '✅ Подтверждено', '✅ Tasdiqlangan'),
    rejected: tr(lang, '❌ Отклонено', '❌ Rad etilgan')
  };
  const productLine = p.product_name ? `${p.product_name}\n` : '';

  await replyAndRemovePrevious(
    ctx,
    `${statusMap[p.status] || p.status}\n${productLine}${p.country} — ${p.price}`,
    mainKeyboard(lang, p.product)
  );
});

bot.catch(err => console.error('BOT ERROR:', err));

bot.launch(() => console.log('✅ Generals Access Bot v2 запущен')).catch(err => {
  console.error('FATAL: bot.launch() failed:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
