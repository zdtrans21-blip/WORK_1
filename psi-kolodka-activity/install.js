require('dotenv').config();
const crypto = require('crypto');
const axios = require('axios');

const VIBECODE_BASE = 'https://vibecode.bitrix24.tech';
const ACTIVITY_CODE = 'psi_kolodka_recognizer';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

/**
 * bizproc.activity.add requires real OAuth-application context in Bitrix24
 * (a plain incoming webhook is refused with 403 ACCESS_DENIED /
 * "Application context required"). VibeCode's own bizproc-activities
 * endpoint therefore only accepts its OAuth app key (vibe_app_…) together
 * with a one-time user session — never the personal vibe_api_ key.
 *
 * Zero-config platform-callback flow: prints a URL for a portal admin to
 * open once, then polls for the session.
 */
async function obtainSessionToken(appKey) {
  const state = crypto.randomUUID();
  const authorizeUrl = `${VIBECODE_BASE}/v1/oauth/authorize?app_key=${encodeURIComponent(appKey)}&state=${state}`;

  console.log('\nОткройте эту ссылку в браузере (под администратором портала aslz.bitrix24.ru) и авторизуйте приложение:');
  console.log(authorizeUrl);
  console.log('\nОжидание авторизации...');

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const { data } = await axios.get(`${VIBECODE_BASE}/v1/oauth/poll`, {
      params: { app_key: appKey, state },
    });
    if (data.status === 'complete') {
      console.log(`Авторизован пользователем: ${data.user?.name || data.user?.id}`);
      return data.access_token;
    }
  }
  throw new Error('Тайм-аут ожидания OAuth-авторизации (10 минут)');
}

function buildProperties() {
  return {
    llm_api_url: {
      Name: 'API URL провайдера LLM',
      Type: 'string',
      Required: 'Y',
      Default: 'https://api.openai.com/v1/chat/completions',
    },
    llm_model: {
      Name: 'Модель LLM',
      Type: 'string',
      Required: 'Y',
      Default: 'gpt-4o',
    },
    llm_api_key: {
      Name: 'API-ключ LLM',
      Type: 'string',
      Required: 'Y',
    },
    item_id: {
      Name: 'ID элемента смарт-процесса',
      Type: 'string',
      Required: 'N',
      Description: 'Обычно не нужно — активити берёт ID элемента, на котором запущен БП, автоматически. Заполняйте, только если нужно распознать протокол другого элемента.',
    },
    source_field_code: {
      Name: 'Код поля с PDF протокола',
      Type: 'string',
      Required: 'Y',
      Default: 'UF_CRM_66_SOURCE_PDF',
      Description: 'Символьный код файлового поля смарт-процесса, откуда брать PDF протокола.',
    },
  };
}

function buildReturnProperties() {
  return {
    ocr_status: { Name: 'Статус распознавания', Type: 'string' },
    ocr_warnings: { Name: 'Поля под сомнением', Type: 'string' },
    error_message: { Name: 'Текст ошибки', Type: 'string' },
  };
}

/** Registers the activity via VibeCode's bizproc-activities wrapper (POST /v1/bizproc-activities). */
async function registerActivity({ appKey, sessionToken, appUrl }) {
  const handler = `${appUrl.replace(/\/$/, '')}/handler`;

  const body = {
    code: ACTIVITY_CODE,
    name: { ru: '🔬 ПСИ Колодка: распознать протокол', en: '🔬 PSI Kolodka: recognize protocol' },
    description:
      'Скачивает PDF протокола ПСИ из поля смарт-процесса, распознаёт химический состав и микроструктуру через LLM, валидирует соответствие нормам, записывает данные в поля карточки.',
    handler,
    authUserId: 1,
    useSubscription: 'N',
    properties: buildProperties(),
    returnProperties: buildReturnProperties(),
    documentType: ['crm', 'Bitrix\\Crm\\Integration\\BizProc\\Document\\Dynamic', 'DYNAMIC_1068'],
  };

  const { data } = await axios.post(`${VIBECODE_BASE}/v1/bizproc-activities`, body, {
    headers: {
      'X-Api-Key': appKey,
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
    },
  });

  return data;
}

async function main() {
  const appKey = requireEnv('VIBE_APP_KEY');
  const appUrl = requireEnv('APP_URL');
  const sessionToken = process.env.VIBE_APP_SESSION_TOKEN || (await obtainSessionToken(appKey));

  const result = await registerActivity({ appKey, sessionToken, appUrl });

  if (result.success) {
    console.log('\n✅ Активити зарегистрировано:', ACTIVITY_CODE);
    console.log(JSON.stringify(result.data, null, 2));
  } else {
    console.error('\n❌ Ошибка регистрации активити:');
    console.error(JSON.stringify(result.error, null, 2));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('install.js failed:', err.response?.data || err.message);
  process.exitCode = 1;
});
