class D1Store {
  constructor(db) { this.db = db; }
  async getUser(id) {
    const row = await this.db.prepare('SELECT data FROM users WHERE id = ?').bind(String(id)).first();
    return row ? JSON.parse(row.data) : {};
  }
  async setUser(id, patch) {
    // json_set preserves explicit nulls, unlike JSON merge-patch, and updates
    // only these fields so concurrent changes to other fields are retained.
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (!entries.length) return;
    const fields = entries.flatMap(([key, value]) => [`$.${key}`, JSON.stringify(value)]);
    const placeholders = entries.map(() => '?, json(?)').join(', ');
    await this.db.prepare(`INSERT INTO users (id, data) VALUES (?, json_set('{}', ${placeholders}))
      ON CONFLICT(id) DO UPDATE SET data = json_set(users.data, ${placeholders})`)
      .bind(String(id), ...fields, ...fields).run();
  }
  async getPayment(id) {
    const row = await this.db.prepare('SELECT data, status FROM payments WHERE id = ?').bind(id).first();
    return row ? { ...JSON.parse(row.data), status: row.status } : undefined;
  }
  async createPayment(payment) {
    const result = await this.db.prepare(`INSERT OR IGNORE INTO payments
      (id, user_id, product, status, created_at, data) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(payment.id, payment.user_id, payment.product || null, payment.status, payment.created_at, JSON.stringify(payment)).run();
    return result.meta.changes === 1;
  }
  async savePayment(payment) {
    const clean = { ...payment };
    delete clean._claim;
    const condition = payment._claim ? " AND status = 'processing' AND claim_id = ?" : " AND status != 'processing'";
    const args = [clean.status, JSON.stringify(clean), clean.id];
    if (payment._claim) args.push(payment._claim);
    const result = await this.db.prepare(`UPDATE payments SET status = ?, data = ?, claim_id = NULL WHERE id = ?${condition}`)
      .bind(...args).run();
    if (result.meta.changes !== 1) throw new Error('Payment claim lost');
  }
  async claimPayment(id) {
    const token = crypto.randomUUID();
    const row = await this.db.prepare(`UPDATE payments SET status = 'processing', claim_id = ?
      WHERE id = ? AND status IN ('pending', 'rejected') RETURNING data`)
      .bind(token, id).first();
    return row ? { ...JSON.parse(row.data), _claim: token } : null;
  }
  async releasePayment(payment) { await this.savePayment(payment); }
  async deletePayment(id) {
    await this.db.prepare("DELETE FROM payments WHERE id = ? AND status = 'pending'").bind(id).run();
  }
  async markReceiptNotified(id) {
    await this.db.prepare("UPDATE payments SET data = json_set(data, '$.receipt_notified', json('true')) WHERE id = ?")
      .bind(id).run();
  }
  async listPayments(userId, product) {
    const query = product
      ? 'SELECT data, status FROM payments WHERE user_id = ? AND product = ? ORDER BY created_at DESC LIMIT 1'
      : 'SELECT data, status FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 1';
    const result = await this.db.prepare(query).bind(...(product ? [userId, product] : [userId])).all();
    return result.results.map(row => ({ ...JSON.parse(row.data), status: row.status }));
  }
  async claimUpdate(id) {
    const now = Date.now();
    const token = crypto.randomUUID();
    const result = await this.db.prepare(`INSERT INTO telegram_updates (id, state, lease_until, claim_id)
      VALUES (?, 'processing', ?, ?) ON CONFLICT(id) DO UPDATE SET
      lease_until = excluded.lease_until, claim_id = excluded.claim_id
      WHERE telegram_updates.state = 'processing' AND telegram_updates.lease_until < ?`)
      .bind(id, now + 120000, token, now).run();
    if (result.meta.changes === 1) return { token };
    const row = await this.db.prepare('SELECT state FROM telegram_updates WHERE id = ?').bind(id).first();
    return { done: row?.state === 'done' };
  }
  async finishUpdate(id, token) {
    await this.db.prepare("UPDATE telegram_updates SET state = 'done', lease_until = ? WHERE id = ? AND claim_id = ?")
      .bind(Date.now() + 7 * 86400000, id, token).run();
  }
  async releaseUpdate(id, token) {
    await this.db.prepare("DELETE FROM telegram_updates WHERE id = ? AND claim_id = ? AND state = 'processing'").bind(id, token).run();
  }
  async cleanupUpdates() {
    await this.db.prepare("DELETE FROM telegram_updates WHERE state = 'done' AND lease_until < ?").bind(Date.now()).run();
  }
}
module.exports = { D1Store };
