const axios = require('axios');

/** Low-level call to a classic Bitrix24 REST method using an OAuth access token. */
async function callMethod(domain, method, params, accessToken) {
  const url = `https://${domain}/rest/${method}.json`;
  const response = await axios.post(url, { ...params, auth: accessToken }, { timeout: 30000 });
  if (response.data?.error) {
    throw new Error(`${method} failed: ${response.data.error} — ${response.data.error_description || ''}`);
  }
  return response.data.result;
}

/** crm.item.get — fetches one smart-process element with its UF_CRM_* fields. */
async function getSmartProcessItem(domain, accessToken, entityTypeId, itemId) {
  const result = await callMethod(
    domain,
    'crm.item.get',
    { entityTypeId, id: itemId, useOriginalUfNames: 'Y' },
    accessToken,
  );
  return result.item;
}

/** crm.item.update — writes fields back onto the smart-process element. */
async function updateSmartProcessItem(domain, accessToken, entityTypeId, itemId, fields) {
  return callMethod(
    domain,
    'crm.item.update',
    { entityTypeId, id: itemId, fields, useOriginalUfNames: 'Y' },
    accessToken,
  );
}

/**
 * Downloads a file body from a Bitrix24 URL. If `accessToken` is given, it is
 * appended as `auth=` (classic disk.file.get DOWNLOAD_URL, which needs it).
 * CRM-item file fields instead hand back an `urlMachine` that already carries
 * its own `auth`/`token` query params — pass no accessToken for those.
 */
async function downloadFile(downloadUrl, accessToken) {
  let url = downloadUrl;
  if (accessToken) {
    const separator = downloadUrl.includes('?') ? '&' : '?';
    url = `${downloadUrl}${separator}auth=${encodeURIComponent(accessToken)}`;
  }
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
  return Buffer.from(response.data);
}

/** bizproc.event.send — completes the activity so the business process can continue. */
async function sendBizprocEvent(domain, accessToken, eventToken, logMessage, returnValues) {
  const url = `https://${domain}/rest/bizproc.event.send.json`;
  const response = await axios.post(url, {
    auth: accessToken,
    event_token: eventToken,
    log_message: logMessage,
    return_values: returnValues,
  }, { timeout: 30000 });
  if (response.data?.error) {
    throw new Error(`bizproc.event.send failed: ${response.data.error} — ${response.data.error_description || ''}`);
  }
  return response.data.result;
}

module.exports = {
  callMethod,
  getSmartProcessItem,
  updateSmartProcessItem,
  downloadFile,
  sendBizprocEvent,
};
