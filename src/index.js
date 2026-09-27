require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const CHANNEL_ID = process.env.CHANNEL_ID;
const INVITE_EXPIRE_MINUTES = Number(process.env.INVITE_EXPIRE_MINUTES || 60);

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

if (!BOT_TOKEN || BOT_TOKEN.includes('PASTE_')) throw new Error('Укажите BOT_TOKEN в .env');
if (!ADMIN_ID) throw new Error('Укажите ADMIN_ID в .env');
if (!CHANNEL_ID) throw new Error('Укажите CHANNEL_ID в .env');

const bot = new Telegraf(BOT_TOKEN);
const DB_PATH = path.join(__dirname, '..', 'data.json');

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

function loadDb() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { users: {}, payments: {} }; }
}
function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
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
    [Markup.button.callback(products.android.name, 'product_android')]
    // iPhone and Gemini Pro temporarily hidden — not working yet
  ]);
}

function productTitle(lang) {
  return tr(
    lang,
    '🎮 GENERALS ANDROID\n\nЧто хотите приобрести?',
    "🎮 GENERALS ANDROID\n\nNimani sotib olmoqchisiz?"
  );
}

function mainTitle(lang, productCode) {
  const product = products[productCode];
  return tr(
    lang,
    `🎮 *${product.name}*\n\nВыберите удобный способ оплаты и после оплаты отправьте чек.\n\n✅ После проверки администратором бот сам выдаст доступ в закрытый канал.`,
    `🎮 *${product.name}*\n\nQulay to'lov turini tanlang va to'lovdan keyin chekni yuboring.\n\n✅ Administrator tekshirganidan so'ng bot yopiq kanalga kirish havolasini beradi.`
  );
}

function mainKeyboard(lang) {
  const supportLink = ADMIN_USERNAME ? `https://t.me/${ADMIN_USERNAME}` : `tg://user?id=${ADMIN_ID}`;
  return Markup.inlineKeyboard([
    [Markup.button.callback(tr(lang, '💳 Оплатить доступ', "💳 To'lov qilish"), 'choose_payment')],
    [Markup.button.callback(tr(lang, '📸 Отправить чек', '📸 Chek yuborish'), 'send_receipt')],
    [Markup.button.callback(tr(lang, '✅ Статус оплаты', "✅ To'lov holati"), 'status')],
    [Markup.button.callback(tr(lang, '🔁 Сменить товар', "🔁 Mahsulotni almashtirish"), 'choose_product')],
    [Markup.button.callback(tr(lang, '🌐 Сменить язык', "🌐 Tilni o'zgartirish"), 'language')],
    [Markup.button.url(tr(lang, '🆘 Поддержка', "🆘 Yordam"), supportLink)]
  ]);
}

function paymentKeyboard(lang, productCode) {
  const product = products[productCode];
  return Markup.inlineKeyboard([
    [Markup.button.callback(`${countryNames.ru} ${product.prices.ru.amount}`, 'pay_ru')],
    [Markup.button.callback(`${countryNames.uz} ${product.prices.uz.amount}`, 'pay_uz')],
    [Markup.button.callback(`${countryNames.kg} ${product.prices.kg.amount}`, 'pay_kg')],
    [Markup.button.callback(tr(lang, '⬅️ Назад', '⬅️ Orqaga'), 'home')]
  ]);
}

bot.start(async (ctx) => {
  setUser(ctx.from.id, {
    username: ctx.from.username || '',
    first_name: ctx.from.first_name || '',
    last_seen: new Date().toISOString()
  });
  await ctx.reply('🎮 GENERALS ANDROID\n\nВыберите язык / Tilni tanlang:', languageKeyboard());
});

bot.action('language', async (ctx) => {
  await safeAnswer(ctx);
  await ctx.editMessageText('Выберите язык / Tilni tanlang:', languageKeyboard());
});

bot.action(/^lang_(ru|uz)$/, async (ctx) => {
  await safeAnswer(ctx);
  const lang = ctx.match[1];
  setUser(ctx.from.id, { lang });
  await ctx.editMessageText(productTitle(lang), productKeyboard());
});

bot.action('choose_product', async (ctx) => {
  await safeAnswer(ctx);
  const lang = getUser(ctx.from.id).lang || 'ru';
  await ctx.editMessageText(productTitle(lang), productKeyboard());
});

bot.action(/^product_(android|iphone|gemini)$/, async (ctx) => {
  await safeAnswer(ctx);
  const productCode = ctx.match[1];
  const lang = getUser(ctx.from.id).lang || 'ru';
  setUser(ctx.from.id, { product: productCode, payment_method: null, waiting_receipt: false });
  await ctx.editMessageText(mainTitle(lang, productCode), { parse_mode: 'Markdown', ...mainKeyboard(lang) });
});

bot.action('home', async (ctx) => {
  await safeAnswer(ctx);
  const user = getUser(ctx.from.id);
  const lang = user.lang || 'ru';

  if (!user.product || !products[user.product]) {
    return ctx.editMessageText(productTitle(lang), productKeyboard());
  }
  await ctx.editMessageText(mainTitle(lang, user.product), { parse_mode: 'Markdown', ...mainKeyboard(lang) });
});

bot.action('choose_payment', async (ctx) => {
  await safeAnswer(ctx);
  const user = getUser(ctx.from.id);
  const lang = user.lang || 'ru';

  if (!user.product || !products[user.product]) {
    return ctx.reply(
      tr(lang, 'Сначала выберите товар.', 'Avval mahsulotni tanlang.'),
      productKeyboard()
    );
  }

  await ctx.reply(
    tr(
      lang,
      '💳 Выберите страну / валюту для оплаты:',
      "💳 To'lov uchun davlat / valyutani tanlang:"
    ),
    paymentKeyboard(lang, user.product)
  );
});

bot.action(/^pay_(ru|uz|kg)$/, async (ctx) => {
  await safeAnswer(ctx);
  const methodCode = ctx.match[1];
  const user = getUser(ctx.from.id);
  const lang = user.lang || 'ru';

  if (!user.product || !products[user.product]) {
    return ctx.reply(
      tr(lang, 'Сначала выберите товар.', 'Avval mahsulotni tanlang.'),
      productKeyboard()
    );
  }

  const product = products[user.product];
  const price = product.prices[methodCode];
  const [requisitesNumber, ...requisitesRest] = price.requisites.split(' ');
  const requisitesLabel = requisitesRest.join(' ');

  setUser(ctx.from.id, {
    payment_method: methodCode,
    waiting_receipt: false
  });

  await ctx.reply(
    tr(
      lang,
      `💳 *Оплата доступа*\n\n📦 ${product.name}\n${countryNames[methodCode]}\nСумма: *${price.amount}*\n\nРеквизиты (нажмите, чтобы скопировать):\n\`${requisitesNumber}\` ${requisitesLabel}\n\nПосле оплаты нажмите «📸 Отправить чек».`,
      `💳 *Kirish uchun to'lov*\n\n📦 ${product.name}\n${countryNames[methodCode]}\nSumma: *${price.amount}*\n\nRekvizitlar (nusxalash uchun bosing):\n\`${requisitesNumber}\` ${requisitesLabel}\n\nTo'lovdan so'ng «📸 Chek yuborish» tugmasini bosing.`
    ),
    { parse_mode: 'Markdown', ...mainKeyboard(lang) }
  );
});

bot.action('send_receipt', async (ctx) => {
  await safeAnswer(ctx);
  const user = getUser(ctx.from.id);
  const lang = user.lang || 'ru';

  if (!user.product || !products[user.product] || !user.payment_method) {
    return ctx.reply(
      tr(lang, 'Сначала выберите способ оплаты.', "Avval to'lov usulini tanlang."),
      user.product ? paymentKeyboard(lang, user.product) : productKeyboard()
    );
  }

  setUser(ctx.from.id, { waiting_receipt: true });
  const product = products[user.product];
  const price = product.prices[user.payment_method];

  await ctx.reply(
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
      mainKeyboard(lang)
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

  await ctx.reply(
    tr(
      lang,
      '✅ Чек получен!\n\nОжидайте проверки. После подтверждения бот автоматически отправит ссылку в закрытый канал.',
      "✅ Chek qabul qilindi!\n\nTekshiruvni kuting. Tasdiqlangach bot yopiq kanal havolasini avtomatik yuboradi."
    ),
    mainKeyboard(lang)
  );
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

  const expireDate = Math.floor(Date.now() / 1000) + INVITE_EXPIRE_MINUTES * 60;
  const productLine = payment.product_name ? `📦 ${payment.product_name}\n` : '';

  let invite;
  try {
    invite = await ctx.telegram.createChatInviteLink(CHANNEL_ID, {
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
  saveDb(db);

  const lang = payment.lang || 'ru';

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

    await ctx.editMessageText(
      `✅ ОПЛАТА ПОДТВЕРЖДЕНА\n\n${profileBlock(payment)}\n${productLine}${payment.country} — ${payment.price}\nСсылка отправлена пользователю.`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('DELIVERY ERROR:', err);
    await ctx.editMessageText(
      `✅ ОПЛАТА ПОДТВЕРЖДЕНА, но не удалось отправить ссылку пользователю (возможно, бот заблокирован).\n\n${profileBlock(payment)}\n${productLine}${payment.country} — ${payment.price}\n\nПерешлите ссылку вручную:\n${invite.invite_link}`,
      { parse_mode: 'HTML' }
    );
  }
});

bot.action(/^reject:(.+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return safeAnswer(ctx, 'Нет доступа');
  await safeAnswer(ctx, 'Отклонено');

  const paymentId = ctx.match[1];
  const db = loadDb();
  const payment = db.payments[paymentId];

  if (!payment) return ctx.reply('Платёж не найден.');

  payment.status = 'rejected';
  payment.rejected_at = new Date().toISOString();
  saveDb(db);

  const lang = payment.lang || 'ru';
  const productLine = payment.product_name ? `📦 ${payment.product_name}\n` : '';
  await ctx.telegram.sendMessage(
    payment.user_id,
    tr(
      lang,
      '❌ Оплата не подтверждена.\n\nПроверьте чек и реквизиты. Если была ошибка, отправьте чек повторно.',
      "❌ To'lov tasdiqlanmadi.\n\nChek va rekvizitlarni tekshiring. Xatolik bo'lsa, chekni qayta yuboring."
    ),
    mainKeyboard(lang)
  );

  await ctx.editMessageText(
    `❌ ОПЛАТА ОТКЛОНЕНА\n\n${profileBlock(payment)}\n${productLine}${payment.country} — ${payment.price}`,
    { parse_mode: 'HTML' }
  );
});

bot.action('status', async (ctx) => {
  await safeAnswer(ctx);
  const user = getUser(ctx.from.id);
  const lang = user.lang || 'ru';
  const db = loadDb();

  const payments = Object.values(db.payments)
    .filter(p => p.user_id === ctx.from.id)
    .sort((a,b) => b.created_at.localeCompare(a.created_at));

  if (!payments.length) {
    return ctx.reply(
      tr(lang, 'У вас пока нет отправленных чеков.', 'Siz hali chek yubormagansiz.'),
      mainKeyboard(lang)
    );
  }

  const p = payments[0];
  const statusMap = {
    pending: tr(lang, '⏳ На проверке', '⏳ Tekshiruvda'),
    approved: tr(lang, '✅ Подтверждено', '✅ Tasdiqlangan'),
    rejected: tr(lang, '❌ Отклонено', '❌ Rad etilgan')
  };
  const productLine = p.product_name ? `${p.product_name}\n` : '';

  await ctx.reply(
    `${statusMap[p.status] || p.status}\n${productLine}${p.country} — ${p.price}`,
    mainKeyboard(lang)
  );
});

bot.catch(err => console.error('BOT ERROR:', err));

bot.launch(() => console.log('✅ Generals Access Bot v2 запущен')).catch(err => {
  console.error('FATAL: bot.launch() failed:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
