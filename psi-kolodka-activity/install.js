require('dotenv').config();
const crypto = require('crypto');
const axios = require('axios');

const VIBECODE_BASE = 'https://vibecode.bitrix24.tech';
const DOCUMENT_TYPE = ['crm', 'Bitrix\\Crm\\Integration\\BizProc\\Document\\Dynamic', 'DYNAMIC_1068'];

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

function buildRecognizerBody(appUrl) {
  return {
    code: 'psi_kolodka_recognizer',
    name: { ru: '🔬 ПСИ Колодка: распознать протокол', en: '🔬 PSI Kolodka: recognize protocol' },
    description:
      'Скачивает PDF протокола ПСИ из поля смарт-процесса, распознаёт химический состав и микроструктуру через LLM, валидирует соответствие нормам, записывает данные в поля карточки.',
    handler: `${appUrl.replace(/\/$/, '')}/handler`,
    authUserId: 1,
    // 'Y' = "Ожидание ответа" checkbox in the BP designer is user-editable
    // and (checked) blocks downstream nodes until bizproc.event.send fires —
    // matches how this activity actually completes (immediate HTTP ack,
    // real result delivered later via event_token).
    useSubscription: 'Y',
    properties: {
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
    },
    returnProperties: {
      ocr_status: { Name: 'Статус распознавания', Type: 'string' },
      ocr_warnings: { Name: 'Поля под сомнением', Type: 'string' },
      error_message: { Name: 'Текст ошибки', Type: 'string' },
      report_full: {
        Name: 'Отчёт: все параметры (норма/факт/отклонение)',
        Type: 'text',
        Description: 'Каждый параметр с нормой на отдельной строке: название, норма, факт, отклонение. Обычный текст, без HTML — статус отмечен эмодзи (✅ в норме, ⚠️ отклонение).',
      },
      report_deviations: {
        Name: 'Отчёт: только отклонения от нормы',
        Type: 'text',
        Description: 'То же самое, но только параметры, у которых факт вышел за пределы нормы. Если отклонений нет — текст "✅ Отклонений не выявлено".',
      },
      changes_report: {
        Name: 'Отчёт: что изменилось (было → стало)',
        Type: 'text',
        Description: 'Только параметры, у которых факт или отклонение отличаются от того, что уже было в карточке до этого запуска. Норма при повторном распознавании не перезаписывается, если уже задана — сравнение идёт против того, что реально останется в поле. Если ничего не изменилось — текст "Изменений нет".',
      },
    },
    documentType: DOCUMENT_TYPE,
  };
}

function buildRecalcBody(appUrl) {
  return {
    code: 'psi_kolodka_recalc_deviation',
    name: { ru: '🔁 ПСИ Колодка: пересчитать отклонение', en: '🔁 PSI Kolodka: recalc deviation' },
    description:
      'Без LLM: перечитывает уже сохранённые поля норма/факт химсостава и микроструктуры и пересчитывает поля отклонения. Для случаев, когда OCR ошибся и норму/факт поправили вручную.',
    handler: `${appUrl.replace(/\/$/, '')}/recalc-handler`,
    authUserId: 1,
    useSubscription: 'Y',
    properties: {
      item_id: {
        Name: 'ID элемента смарт-процесса',
        Type: 'string',
        Required: 'N',
        Description: 'Обычно не нужно — активити берёт ID элемента, на котором запущен БП, автоматически. Заполняйте, только если нужно пересчитать другой элемент.',
      },
    },
    returnProperties: {
      status: { Name: 'Статус пересчёта', Type: 'string' },
      error_message: { Name: 'Текст ошибки', Type: 'string' },
      recalculated: { Name: 'Пересчитанные поля', Type: 'string' },
      report: {
        Name: 'Отчёт: все параметры (норма/факт/отклонение)',
        Type: 'text',
        Description: 'То же самое, что report_full у основной активити: каждый параметр с нормой на отдельной строке, обычный текст, статус отмечен эмодзи (✅ в норме, ⚠️ отклонение). Строится по текущим значениям норма/факт в карточке — то есть по уже поправленным вручную данным.',
      },
    },
    documentType: DOCUMENT_TYPE,
  };
}

const ACTIVITIES = [
  { code: 'psi_kolodka_recognizer', build: buildRecognizerBody },
  { code: 'psi_kolodka_recalc_deviation', build: buildRecalcBody },
];

/**
 * Registers or updates one activity via VibeCode's bizproc-activities
 * wrapper. Tries PATCH (update) first since re-running install.js after the
 * initial deploy is the common case (e.g. adding new returnProperties) —
 * falls back to POST (create) the first time, when the activity doesn't
 * exist yet.
 */
async function registerActivity({ code, body, headers }) {
  try {
    const { data } = await axios.patch(`${VIBECODE_BASE}/v1/bizproc-activities/${code}`, body, { headers });
    return data;
  } catch (err) {
    const errCode = err.response?.data?.error?.code;
    if (err.response?.status !== 404 && errCode !== 'NOT_FOUND') throw err;
    console.log(`Активити ${code} ещё не зарегистрировано — создаю (PATCH вернул "не найдено").`);
    const { data } = await axios.post(`${VIBECODE_BASE}/v1/bizproc-activities`, body, { headers });
    return data;
  }
}

async function main() {
  const appKey = requireEnv('VIBE_APP_KEY');
  const appUrl = requireEnv('APP_URL');
  const sessionToken = process.env.VIBE_APP_SESSION_TOKEN || (await obtainSessionToken(appKey));
  const headers = {
    'X-Api-Key': appKey,
    Authorization: `Bearer ${sessionToken}`,
    'Content-Type': 'application/json',
  };

  let hadError = false;
  for (const { code, build } of ACTIVITIES) {
    const result = await registerActivity({ code, body: build(appUrl), headers });
    if (result.success) {
      console.log(`\n✅ Активити зарегистрировано: ${code}`);
      console.log(JSON.stringify(result.data, null, 2));
    } else {
      hadError = true;
      console.error(`\n❌ Ошибка регистрации активити ${code}:`);
      console.error(JSON.stringify(result.error, null, 2));
    }
  }
  if (hadError) process.exitCode = 1;
}

main().catch((err) => {
  console.error('install.js failed:', err.response?.data || err.message);
  process.exitCode = 1;
});
