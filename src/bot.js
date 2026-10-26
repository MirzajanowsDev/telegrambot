const { Telegraf, Markup, Context } = require('telegraf');

function createBot(env, store, options = {}) {

const BOT_TOKEN = env.BOT_TOKEN;
const ADMIN_ID = Number(env.ADMIN_ID);
const ADMIN_USERNAME = normalizeUsername(env.ADMIN_USERNAME || '');
const DEFAULT_SUPPORT_USERNAME = normalizeUsername(env.DEFAULT_SUPPORT_USERNAME || ADMIN_USERNAME || 'mirzajonows');
const CHANNEL_ID = env.CHANNEL_ID;
const CHANNEL_CS16_ID = env.CHANNEL_CS16_ID || '-1004335642053';
const CHANNEL_DOTA2_ID = env.CHANNEL_DOTA2_ID ?? '-1004334193236';
const INVITE_EXPIRE_MINUTES = Number(env.INVITE_EXPIRE_MINUTES || 60);
const BOT_HEADING = '🎮 GENERALS & CS 1.6 ANDROID & Gemini Pro & Dota 2';

const countryNames = {
  ru: '🇷🇺 Россия',
  uz: "🇺🇿 O'zbekiston",
  kg: '🇰🇬 Кыргызстан'
};

// RU/KG requisites are shared across all products. UZ requisites are split per product group.
const PAYMENT_RU = env.PAYMENT_RU || 'Реквизиты не указаны';
const PAYMENT_KG = env.PAYMENT_KG || 'Реквизиттер көрсөтүлгөн эмес';
const PAYMENT_UZ_ANDROID = env.PAYMENT_UZ_ANDROID || "Rekvizitlar ko'rsatilmagan";
const PAYMENT_UZ_GEMINI = env.PAYMENT_UZ_GEMINI || "Rekvizitlar ko'rsatilmagan";

const products = {
  dota2: {
    name: '⚔️ Dota 2 на Android',
    nameUz: '⚔️ Android uchun Dota 2',
    prices: {
      ru: { amount: env.PRICE_DOTA2_RU || '500 ₽', requisites: PAYMENT_RU },
      uz: { amount: env.PRICE_DOTA2_UZ || '60 000 сум', requisites: env.PAYMENT_UZ_DOTA2 || PAYMENT_UZ_ANDROID },
      kg: { amount: env.PRICE_DOTA2_KG || '500 сом', requisites: PAYMENT_KG }
    }
  },
  cs16: {
    name: '🎯 Counter-Strike 1.6 Android',
    prices: {
      ru: { amount: env.PRICE_CS16_RU || '700 ₽', requisites: PAYMENT_RU },
      uz: { amount: env.PRICE_CS16_UZ || '50 000 сум', requisites: env.PAYMENT_UZ_CS16 || PAYMENT_UZ_ANDROID },
      kg: { amount: env.PRICE_CS16_KG || '500 сом', requisites: PAYMENT_KG }
    }
  },
  android: {
    name: '🎮 Generals Android',
    prices: {
      ru: { amount: env.PRICE_ANDROID_RU || '500 ₽', requisites: PAYMENT_RU },
      uz: { amount: env.PRICE_ANDROID_UZ || '50 000 сум', requisites: PAYMENT_UZ_ANDROID },
      kg: { amount: env.PRICE_ANDROID_KG || '500 сом', requisites: PAYMENT_KG }
    }
  },
  iphone: {
    name: '🎮 Generals iPhone',
    prices: {
      ru: { amount: env.PRICE_IPHONE_RU || '1000 ₽', requisites: PAYMENT_RU },
      uz: { amount: env.PRICE_IPHONE_UZ || '80 000 сум', requisites: PAYMENT_UZ_ANDROID },
      kg: { amount: env.PRICE_IPHONE_KG || '700 сом', requisites: PAYMENT_KG }
    }
  },
  gemini: {
    name: '🤖 Gemini Pro',
    prices: {
      ru: { amount: env.PRICE_GEMINI_RU || '500 ₽', requisites: PAYMENT_RU },
      uz: { amount: env.PRICE_GEMINI_UZ || '50 000 сум', requisites: PAYMENT_UZ_GEMINI },
      kg: { amount: env.PRICE_GEMINI_KG || '500 сом', requisites: PAYMENT_KG }
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
].filter(key => !env[key]);
if (missingPaymentConfig.length) {
  throw new Error(`Укажите реквизиты в .env: ${missingPaymentConfig.join(', ')}`);
}
if (!Number.isInteger(INVITE_EXPIRE_MINUTES) || INVITE_EXPIRE_MINUTES <= 0) {
  throw new Error('INVITE_EXPIRE_MINUTES должен быть положительным целым числом');
}
for (const [key, username] of Object.entries({ DEFAULT_SUPPORT_USERNAME })) {
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    throw new Error(`${key} содержит некорректный Telegram username`);
  }
}

const botOptions = {};
if (options.callApi) {
  botOptions.contextType = class extends Context {
    constructor(update, telegram, botInfo) {
      super(update, telegram, botInfo);
      telegram.callApi = options.callApi;
    }
  };
}
const bot = new Telegraf(BOT_TOKEN, botOptions);
if (options.callApi) bot.telegram.callApi = options.callApi;

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
  await safeDeleteMessage(ctx, messageId);
}

async function safeDeleteMessage(ctx, messageId) {
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

async function replyAndRemoveUserCommand(ctx, text, extra) {
  const message = await ctx.reply(text, extra);
  await safeDeleteMessage(ctx, ctx.message && ctx.message.message_id);
  return message;
}

async function getUser(id) { return store.getUser(id); }
async function setUser(id, patch) { return store.setUser(id, patch); }
function tr(lang, ru, uz) {
  return lang === 'uz' ? uz : ru;
}

function productName(productCode, lang) {
  const product = products[productCode];
  return lang === 'uz' && product.nameUz ? product.nameUz : product.name;
}

function paymentAvailable(productCode) {
  if (productCode !== 'dota2') return true;
  return /^-100\d+$/.test(CHANNEL_DOTA2_ID)
    && Object.values(products.dota2.prices).every(price => price.amount.trim() && price.requisites.trim());
}

function dota2Details(lang) {
  return tr(lang,
    '📱 Игра для Android на Unity. По информации продавца, APK запускается на телефоне без эмулятора. Перед оплатой уточните у поддержки требования и совместимость с вашим устройством. После проверки чека бот выдаст доступ в отдельный закрытый канал.',
    "📱 Unity asosidagi Android o'yini. Sotuvchi ma'lumotiga ko'ra, APK telefonda emulyatorsiz ishlaydi. To'lovdan oldin yordam xizmatidan talablar va qurilmangizga mosligini aniqlang. Chek tekshirilgach bot alohida yopiq kanalga kirish beradi."
  );
}

function paymentUnavailableText(lang) {
  return tr(lang,
    '⏳ Продажа Dota 2 на Android пока недоступна. Уточните готовность у поддержки. Не переводите деньги за этот товар.',
    "⏳ Android uchun Dota 2 savdosi hozircha mavjud emas. Tayyorligini yordam xizmatidan aniqlang. Bu mahsulot uchun pul o'tkazmang."
  );
}

async function replyPaymentUnavailable(ctx, lang) {
  await setUser(ctx.from.id, { payment_method: null, waiting_receipt: false });
  return replyAndRemovePrevious(ctx, paymentUnavailableText(lang), mainKeyboard(lang, 'dota2'));
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
  return Markup.keyboard([
    ['🇷🇺 Русский', "🇺🇿 O'zbekcha"]
  ]).resize().persistent();
}

function replyMenuKeyboard(lang) {
  return Markup.keyboard([
    [tr(lang, '🛒 Меню товаров', '🛒 Mahsulotlar')],
    [tr(lang, '🌐 Изменить язык', "🌐 Tilni o'zgartirish")]
  ]).resize().persistent();
}

function productKeyboard(lang = 'ru') {
  return Markup.inlineKeyboard([
    [Markup.button.callback(products.android.name, 'product_android')],
    [Markup.button.callback(products.cs16.name, 'product_cs16')],
    [Markup.button.callback(products.gemini.name, 'product_gemini')],
    [Markup.button.callback(productName('dota2', lang), 'product_dota2')]
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

function geminiActivationInstructions(lang) {
  return tr(
    lang,
    '🔗 Мы отправим вам ссылку для активации Gemini Pro в течение 30 минут. Пожалуйста, будьте онлайн в это время.\n\n🎥 Когда получите ссылку, сначала включите запись экрана, затем откройте ссылку и активируйте Gemini Pro.\n\n⚠️ Обязательно запишите весь процесс. Если записи экрана не будет и при активации возникнет проблема, мы не сможем помочь.',
    "🔗 Gemini Pro faollashtirish havolasini 30 daqiqa ichida yuboramiz. Iltimos, shu vaqt davomida onlayn bo'ling.\n\n🎥 Havolani olganingizda, avval ekran yozuvini yoqing, so'ng havolani ochib Gemini Pro'ni faollashtiring.\n\n⚠️ Jarayonni to'liq yozib oling. Ekran yozuvi bo'lmasa va faollashtirishda muammo yuz bersa, yordam bera olmaymiz."
  );
}

function geminiPackageDetails(lang) {
  return tr(
    lang,
    '📦 *В пакет на срок до 18 месяцев входят:*\n• Gemini Pro\n• Google One\n• Nano Banana\n• 5 TB Google Drive\n• Antigravity\n• Flow',
    "📦 *18 oygacha bo'lgan paket tarkibiga quyidagilar kiradi:*\n• Gemini Pro\n• Google One\n• Nano Banana\n• 5 TB Google Drive\n• Antigravity\n• Flow"
  );
}

function mainTitle(lang, productCode) {
  if (productCode === 'dota2' && !paymentAvailable(productCode)) {
    return `🎮 *${productName(productCode, lang)}*\n\n${dota2Details(lang)}\n\n${paymentUnavailableText(lang)}`;
  }
  const deliveryText = productCode === 'gemini'
    ? tr(
      lang,
      '✅ После проверки оплаты мы отправим ссылку для активации Gemini Pro в течение 30 минут.',
      "✅ To'lov tekshirilgandan so'ng Gemini Pro faollashtirish havolasini 30 daqiqa ichida yuboramiz."
    )
    : tr(
      lang,
      '✅ После проверки администратором бот сам выдаст доступ в закрытый канал.',
      "✅ Administrator tekshirganidan so'ng bot yopiq kanalga kirish havolasini beradi."
    );
  const packageDetails = productCode === 'gemini' ? `\n\n${geminiPackageDetails(lang)}`
    : productCode === 'dota2' ? `\n\n${dota2Details(lang)}` : '';
  return tr(
    lang,
    `🎮 *${productName(productCode, lang)}*${packageDetails}\n\nВыберите удобный способ оплаты и после оплаты отправьте чек.\n\n${deliveryText}`,
    `🎮 *${productName(productCode, lang)}*${packageDetails}\n\nQulay to'lov turini tanlang va to'lovdan keyin chekni yuboring.\n\n${deliveryText}`
  );
}

function mainKeyboard(lang, productCode) {
  const supportLink = `https://t.me/${DEFAULT_SUPPORT_USERNAME}`;
  return Markup.inlineKeyboard([
    ...(paymentAvailable(productCode) ? [
      [Markup.button.callback(tr(lang, '💳 Оплатить доступ', "💳 To'lov qilish"), 'choose_payment')],
      [Markup.button.callback(tr(lang, '📸 Отправить чек', '📸 Chek yuborish'), 'send_receipt')]
    ] : []),
    [Markup.button.callback(tr(lang, '✅ Статус оплаты', "✅ To'lov holati"), 'status')],
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
  await setUser(ctx.from.id, {
    username: ctx.from.username || '',
    first_name: ctx.from.first_name || '',
    last_seen: new Date().toISOString(),
    product: null,
    payment_method: null,
    waiting_receipt: false,
    language_prompt_message_id: null
  });
  const prompt = await ctx.reply(`${BOT_HEADING}\n\nВыберите язык / Tilni tanlang:`, languageKeyboard());
  await setUser(ctx.from.id, { language_prompt_message_id: prompt.message_id });
});

// Compatibility for language buttons in messages sent by older bot versions.
bot.action('language', async (ctx) => {
  await safeAnswer(ctx);
  const prompt = await replyAndRemovePrevious(ctx, 'Выберите язык / Tilni tanlang:', languageKeyboard());
  await setUser(ctx.from.id, { language_prompt_message_id: prompt.message_id });
});

async function selectLanguage(ctx, lang, answerCallback = false) {
  if (answerCallback) await safeAnswer(ctx);
  const user = await getUser(ctx.from.id);
  await setUser(ctx.from.id, { lang });
  const navigationText = tr(lang, '✅ Выбран русский язык.', "✅ O'zbek tili tanlandi.");
  if (user.product && products[user.product]) {
    if (answerCallback) {
      const message = await ctx.editMessageText(
        mainTitle(lang, user.product),
        { parse_mode: 'Markdown', ...mainKeyboard(lang, user.product) }
      );
      await ctx.reply(navigationText, replyMenuKeyboard(lang));
      await setUser(ctx.from.id, { language_prompt_message_id: null });
      return message;
    }
    await ctx.reply(navigationText, replyMenuKeyboard(lang));
    const message = await ctx.reply(
      mainTitle(lang, user.product),
      { parse_mode: 'Markdown', ...mainKeyboard(lang, user.product) }
    );
    await safeDeleteMessage(ctx, ctx.message && ctx.message.message_id);
    await safeDeleteMessage(ctx, user.language_prompt_message_id);
    await setUser(ctx.from.id, { language_prompt_message_id: null });
    return message;
  }
  if (answerCallback) {
    const message = await ctx.editMessageText(productTitle(lang), productKeyboard(lang));
    await ctx.reply(navigationText, replyMenuKeyboard(lang));
    await setUser(ctx.from.id, { language_prompt_message_id: null });
    return message;
  }
  await ctx.reply(navigationText, replyMenuKeyboard(lang));
  const message = await ctx.reply(productTitle(lang), productKeyboard(lang));
  await safeDeleteMessage(ctx, ctx.message && ctx.message.message_id);
  await safeDeleteMessage(ctx, user.language_prompt_message_id);
  await setUser(ctx.from.id, { language_prompt_message_id: null });
  return message;
}

bot.action(/^lang_(ru|uz)$/, async (ctx) => {
  return selectLanguage(ctx, ctx.match[1], true);
});

bot.hears('🇷🇺 Русский', async (ctx) => {
  return selectLanguage(ctx, 'ru');
});

bot.hears("🇺🇿 O'zbekcha", async (ctx) => {
  return selectLanguage(ctx, 'uz');
});

async function showLanguageChoices(ctx) {
  const prompt = await replyAndRemoveUserCommand(ctx, 'Выберите язык / Tilni tanlang:', languageKeyboard());
  await setUser(ctx.from.id, { language_prompt_message_id: prompt.message_id });
}

bot.hears('🌐 Изменить язык', showLanguageChoices);
bot.hears("🌐 Tilni o'zgartirish", showLanguageChoices);

async function openProductMenu(ctx) {
  const user = await getUser(ctx.from.id);
  const lang = user.lang || 'ru';
  await setUser(ctx.from.id, { product: null, payment_method: null, waiting_receipt: false });
  return replyAndRemoveUserCommand(ctx, productTitle(lang), productKeyboard(lang));
}

bot.hears('🛒 Меню товаров', openProductMenu);
bot.hears('🛒 Mahsulotlar', openProductMenu);
bot.hears('🛍 Product menu', openProductMenu);

bot.action('choose_product', async (ctx) => {
  await safeAnswer(ctx);
  const lang = (await getUser(ctx.from.id)).lang || 'ru';
  await ctx.editMessageText(productTitle(lang), productKeyboard(lang));
});

bot.action(/^product_(android|iphone|gemini|cs16|dota2)$/, async (ctx) => {
  await safeAnswer(ctx);
  const productCode = ctx.match[1];
  const lang = (await getUser(ctx.from.id)).lang || 'ru';
  await setUser(ctx.from.id, { product: productCode, payment_method: null, waiting_receipt: false });
  await ctx.editMessageText(mainTitle(lang, productCode), { parse_mode: 'Markdown', ...mainKeyboard(lang, productCode) });
});

bot.action('home', async (ctx) => {
  await safeAnswer(ctx);
  const user = await getUser(ctx.from.id);
  const lang = user.lang || 'ru';

  if (!user.product || !products[user.product]) {
    return ctx.editMessageText(productTitle(lang), productKeyboard(lang));
  }
  await ctx.editMessageText(mainTitle(lang, user.product), { parse_mode: 'Markdown', ...mainKeyboard(lang, user.product) });
});

bot.action('choose_payment', async (ctx) => {
  await safeAnswer(ctx);
  const user = await getUser(ctx.from.id);
  const lang = user.lang || 'ru';
  if (!paymentAvailable(user.product)) return replyPaymentUnavailable(ctx, lang);

  if (!user.product || !products[user.product]) {
    return replyAndRemovePrevious(
      ctx,
      tr(lang, 'Сначала выберите товар.', 'Avval mahsulotni tanlang.'),
      productKeyboard(lang)
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
  const user = await getUser(ctx.from.id);
  const lang = user.lang || 'ru';
  if (!paymentAvailable(productCode)) return replyPaymentUnavailable(ctx, lang);

  if (!productCode || !products[productCode]) {
    return replyAndRemovePrevious(
      ctx,
      tr(lang, 'Сначала выберите товар.', 'Avval mahsulotni tanlang.'),
      productKeyboard(lang)
    );
  }

  const product = products[productCode];
  const price = product.prices[methodCode];
  const { number: requisitesNumber, label: requisitesLabel } = splitRequisites(price.requisites);

  await setUser(ctx.from.id, {
    product: productCode,
    payment_method: methodCode,
    waiting_receipt: false
  });

  await replyAndRemovePrevious(
    ctx,
    tr(
      lang,
      `💳 *Оплата доступа*\n\n📦 ${productName(productCode, lang)}\n${countryNames[methodCode]}\nСумма: *${price.amount}*\n\nРеквизиты (нажмите, чтобы скопировать):\n\`${requisitesNumber}\` ${requisitesLabel}\n\nПосле оплаты нажмите «📸 Отправить чек».`,
      `💳 *Kirish uchun to'lov*\n\n📦 ${productName(productCode, lang)}\n${countryNames[methodCode]}\nSumma: *${price.amount}*\n\nRekvizitlar (nusxalash uchun bosing):\n\`${requisitesNumber}\` ${requisitesLabel}\n\nTo'lovdan so'ng «📸 Chek yuborish» tugmasini bosing.`
    ),
    { parse_mode: 'Markdown', ...mainKeyboard(lang, productCode) }
  );
}

bot.action(/^pay_(android|iphone|gemini|cs16|dota2)_(ru|uz|kg)$/, async (ctx) => {
  return selectPayment(ctx, ctx.match[1], ctx.match[2]);
});

// Keep old messages with pre-product callback data functional.
bot.action(/^pay_(ru|uz|kg)$/, async (ctx) => {
  const user = await getUser(ctx.from.id);
  return selectPayment(ctx, user.product, ctx.match[1]);
});

bot.action('send_receipt', async (ctx) => {
  await safeAnswer(ctx);
  const user = await getUser(ctx.from.id);
  const lang = user.lang || 'ru';
  if (!paymentAvailable(user.product)) return replyPaymentUnavailable(ctx, lang);

  if (!user.product || !products[user.product] || !user.payment_method) {
    return replyAndRemovePrevious(
      ctx,
      tr(lang, 'Сначала выберите способ оплаты.', "Avval to'lov usulini tanlang."),
      user.product ? paymentKeyboard(lang, user.product) : productKeyboard(lang)
    );
  }

  await setUser(ctx.from.id, { waiting_receipt: true });

  const product = products[user.product];
  const price = product.prices[user.payment_method];

  await replyAndRemovePrevious(
    ctx,
    tr(
      lang,
      `📸 Отправьте фото или PDF чека.\n\nТовар: ${productName(user.product, lang)}\nОплата: ${countryNames[user.payment_method]} — ${price.amount}`,
      `📸 Chek rasmi yoki PDF faylini yuboring.\n\nMahsulot: ${productName(user.product, lang)}\nTo'lov: ${countryNames[user.payment_method]} — ${price.amount}`
    )
  );
});

async function acceptReceipt(ctx) {
  let user = await getUser(ctx.from.id);
  const paymentId = `${ctx.message.message_id}_${ctx.chat.id}`;
  const existing = await store.getPayment(paymentId);
  if (existing) {
    if (existing.receipt_notified || existing.status !== 'pending') return;
    // Resume a webhook interrupted after saving the receipt, using its snapshot.
    user = { ...user, lang: existing.lang, product: existing.product,
      payment_method: existing.payment_method, waiting_receipt: true };
  }
  const lang = user.lang || 'ru';
  if (!paymentAvailable(user.product)) return replyPaymentUnavailable(ctx, lang);

  if (!user.waiting_receipt || !user.product || !products[user.product] || !user.payment_method) {
    return ctx.reply(
      tr(lang, 'Сначала выберите оплату и нажмите «📸 Отправить чек».', "Avval to'lovni tanlang va «📸 Chek yuborish» tugmasini bosing."),
      mainKeyboard(lang, user.product)
    );
  }

  const product = products[user.product];
  const price = product.prices[user.payment_method];
  const payment = existing || {
    id: paymentId,
    user_id: ctx.from.id,
    username: ctx.from.username || '',
    first_name: ctx.from.first_name || '',
    lang,
    product: user.product,
    product_name: productName(user.product, lang),
    payment_method: user.payment_method,
    price: price.amount,
    country: countryNames[user.payment_method],
    status: 'pending',
    created_at: new Date().toISOString(),
    source_chat_id: ctx.chat.id,
    source_message_id: ctx.message.message_id
  };
  if (!existing && !await store.createPayment(payment)) return;
  await setUser(ctx.from.id, { waiting_receipt: false });

  try {
    await ctx.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
    await ctx.telegram.sendMessage(
      ADMIN_ID,
      `🧾 Новый чек\n\n${profileBlock(payment)}\n📦 ${payment.product_name}\n🌍 ${payment.country}\n💳 ${payment.price}\n\nПодтвердить оплату?`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Подтвердить', `approve:${paymentId}`),
          Markup.button.callback('❌ Отклонить', `reject:${paymentId}`)
        ]
      ]) }
    );
  } catch (err) {
    console.error('ADMIN DELIVERY ERROR', err.response?.error_code || 'network');
    await store.deletePayment(paymentId);
    await setUser(ctx.from.id, { waiting_receipt: true });
    return ctx.reply(
      tr(
        lang,
        '❗ Не удалось отправить чек администратору. Попробуйте отправить его ещё раз или обратитесь в поддержку.',
        "❗ Chekni administratorga yuborib bo'lmadi. Uni qayta yuboring yoki yordam xizmatiga murojaat qiling."
      ),
      mainKeyboard(lang, user.product)
    );
  }

  await store.markReceiptNotified(paymentId);

  const receiptConfirmation = user.product === 'gemini'
    ? tr(
      lang,
      '✅ Чек получен!\n\nОжидайте проверки. После подтверждения мы отправим ссылку для активации Gemini Pro в течение 30 минут. Пожалуйста, будьте онлайн.',
      "✅ Chek qabul qilindi!\n\nTekshiruvni kuting. Tasdiqlangach Gemini Pro faollashtirish havolasini 30 daqiqa ichida yuboramiz. Iltimos, onlayn bo'ling."
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

  const lang = (await getUser(ctx.from.id)).lang || 'ru';
  await ctx.reply(tr(lang, 'Отправьте фото или PDF чека.', 'Chek rasmi yoki PDF faylini yuboring.'));
});

bot.action(/^approve:(.+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return safeAnswer(ctx, 'Нет доступа');
  await safeAnswer(ctx, 'Подтверждаю…');

  const paymentId = ctx.match[1];
  let payment = await store.getPayment(paymentId);

  if (!payment) return ctx.reply('Платёж не найден.');
  if (payment.status === 'approved') return ctx.reply('Уже подтверждено.');
  if (payment.status === 'processing') return ctx.reply('⏳ Этот платёж уже обрабатывается.');
  if (!paymentAvailable(payment.product)) return ctx.reply('❗ Проверьте настройки канала товара.');
  payment = await store.claimPayment(paymentId);
  if (!payment) return ctx.reply('⏳ Этот платёж уже обрабатывается.');

  const lang = payment.lang || 'ru';
  const productLine = payment.product_name ? `📦 ${payment.product_name}\n` : '';

  if (payment.product === 'gemini') {
    payment.status = 'approved';
    payment.approved_at = new Date().toISOString();
    delete payment.rejected_at;
    await store.savePayment(payment);

    let delivered = true;
    try {
      await ctx.telegram.sendMessage(
        payment.user_id,
        tr(
          lang,
          `✅ *Оплата подтверждена!*\n\n${productLine}${payment.country} — ${payment.price}\n\n${geminiActivationInstructions(lang)}`,
          `✅ *To'lov tasdiqlandi!*\n\n${productLine}${payment.country} — ${payment.price}\n\n${geminiActivationInstructions(lang)}`
        ),
        { parse_mode: 'Markdown', ...mainKeyboard(lang, 'gemini') }
      );
    } catch (err) {
      delivered = false;
      console.error('DELIVERY ERROR', err.response?.error_code || 'network');
    }
    const deliveryLine = delivered
      ? `Пользователю отправлены инструкции. @${DEFAULT_SUPPORT_USERNAME} должен отправить ссылку активации в течение 30 минут.`
      : 'Уведомление не доставлено пользователю. Свяжитесь с ним вручную.';
    await ctx.editMessageText(
      `✅ ОПЛАТА GEMINI PRO ПОДТВЕРЖДЕНА\n\n${profileBlock(payment)}\n${productLine}${payment.country} — ${payment.price}\n${deliveryLine}`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Resolve from the paid product, never the user's current menu selection.
  const channelId = payment.product === 'dota2' ? CHANNEL_DOTA2_ID
    : payment.product === 'cs16' ? CHANNEL_CS16_ID : CHANNEL_ID;

  const expireDate = Math.floor(Date.now() / 1000) + INVITE_EXPIRE_MINUTES * 60;

  let invite;
  try {
    invite = await ctx.telegram.createChatInviteLink(channelId, {
      name: `pay_${payment.user_id}`,
      expire_date: expireDate,
      member_limit: 1
    });
  } catch (err) {
    console.error('INVITE ERROR', err.response?.error_code || 'network');
    if (!err.response?.error_code || err.response.error_code >= 500) {
      return ctx.reply('❗ Результат создания приглашения неизвестен. Платёж оставлен в обработке. Проверьте канал перед повторной выдачей доступа.');
    }
    await store.releasePayment(payment);
    return ctx.reply('❗ Не удалось создать ссылку. Проверьте права бота в закрытом канале.');
  }

  payment.status = 'approved';
  payment.approved_at = new Date().toISOString();
  payment.invite_link = invite.invite_link;
  delete payment.rejected_at;
  await store.savePayment(payment);

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
    console.error('DELIVERY ERROR', err.response?.error_code || 'network');
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
  const payment = await store.getPayment(paymentId);
  const lang = (await getUser(ctx.from.id)).lang || payment?.lang || 'ru';

  if (!payment || payment.user_id !== ctx.from.id) {
    return replyAndRemovePrevious(ctx, tr(lang, 'Платёж не найден.', "To'lov topilmadi."));
  }
  if (payment.status !== 'rejected' || !products[payment.product] || !countryNames[payment.payment_method]) {
    return replyAndRemovePrevious(ctx, tr(lang, 'Этот чек нельзя отправить повторно.', "Bu chekni qayta yuborib bo'lmaydi."));
  }

  if (!paymentAvailable(payment.product)) return replyPaymentUnavailable(ctx, lang);

  await setUser(ctx.from.id, {
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
  let payment = await store.getPayment(paymentId);

  if (!payment) return ctx.reply('Платёж не найден.');
  if (payment.status === 'approved') return ctx.reply('Нельзя отклонить уже подтверждённую оплату.');
  if (payment.status === 'rejected') return ctx.reply('Уже отклонено.');
  if (payment.status === 'processing') return ctx.reply('⏳ Этот платёж уже обрабатывается.');
  payment = await store.claimPayment(paymentId);
  if (!payment) return ctx.reply('⏳ Этот платёж уже обрабатывается.');

  payment.status = 'rejected';
  payment.rejected_at = new Date().toISOString();
  await store.savePayment(payment);

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
          `https://t.me/${DEFAULT_SUPPORT_USERNAME}`
        )]
      ])
    );
  } catch (err) {
    delivered = false;
    console.error('DELIVERY ERROR', err.response?.error_code || 'network');
  }

  await ctx.editMessageText(
    `❌ ОПЛАТА ОТКЛОНЕНА\n\n${profileBlock(payment)}\n${productLine}${payment.country} — ${payment.price}${delivered ? '' : '\nУведомление не доставлено пользователю.'}`,
    { parse_mode: 'HTML' }
  );
});

bot.action('status', async (ctx) => {
  await safeAnswer(ctx);
  const user = await getUser(ctx.from.id);
  const lang = user.lang || 'ru';
  const payments = await store.listPayments(ctx.from.id, user.product);

  if (!payments.length) {
    const selectedProductName = user.product && products[user.product] ? productName(user.product, lang) : '';
    return replyAndRemovePrevious(
      ctx,
      tr(
        lang,
        selectedProductName ? `У вас пока нет отправленных чеков для ${selectedProductName}.` : 'У вас пока нет отправленных чеков.',
        `${selectedProductName || 'Bu mahsulot'} uchun hali chek yubormagansiz.`
      ),
      mainKeyboard(lang, user.product)
    );
  }

  const p = payments[0];
  const statusMap = {
    pending: tr(lang, '⏳ На проверке', '⏳ Tekshiruvda'),
    processing: tr(lang, '⏳ Обрабатывается', '⏳ Qayta ishlanmoqda'),
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

// Telegraf's default error handler logs the entire update. Rethrow without
// logging personal message contents, so the webhook can return a retry status.
bot.catch(options.onError || (error => { throw error; }));
return { bot, products, productKeyboard, productTitle, mainTitle, mainKeyboard,
  paymentKeyboard, replyMenuKeyboard, languageKeyboard, splitRequisites };
}
module.exports = { createBot };
