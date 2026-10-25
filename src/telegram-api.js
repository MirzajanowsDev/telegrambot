function createTelegramApi(token, fetchImpl = fetch) {
  return async (method, payload = {}) => {
    let response;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });
    } catch {
      // Never expose fetch's URL in an exception: it contains the bot token.
      throw new Error(`Telegram ${method} request failed`);
    }
    let result;
    try { result = await response.json(); }
    catch { throw new Error(`Telegram ${method} returned an invalid response`); }
    if (!response.ok || !result.ok) {
      const error = new Error(`Telegram ${method} failed (${result.error_code || response.status})`);
      error.response = { error_code: result.error_code || response.status };
      throw error;
    }
    return result.result;
  };
}
module.exports = { createTelegramApi };
