const fs = require('node:fs');
const path = require('node:path');

class JsonStore {
  constructor(file) { this.file = file; }
  read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { users: {}, payments: {} }; throw error; }
  }
  write(db) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(db, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
  async getUser(id) { return this.read().users[String(id)] || {}; }
  async setUser(id, patch) {
    const db = this.read();
    db.users[String(id)] = { ...db.users[String(id)], ...patch };
    this.write(db);
  }
  async getPayment(id) { return this.read().payments[id]; }
  async createPayment(payment) {
    const db = this.read();
    if (db.payments[payment.id]) return false;
    db.payments[payment.id] = payment;
    this.write(db);
    return true;
  }
  async savePayment(payment) {
    const db = this.read();
    if (payment._claim && db.payments[payment.id]?._claim !== payment._claim) throw new Error('Payment claim lost');
    const clean = { ...payment };
    delete clean._claim;
    db.payments[payment.id] = clean;
    this.write(db);
  }
  async claimPayment(id) {
    const db = this.read();
    const payment = db.payments[id];
    if (!payment || !['pending', 'rejected'].includes(payment.status)) return null;
    const claimed = { ...payment, _claim: require('node:crypto').randomUUID() };
    db.payments[id] = { ...claimed, status: 'processing' };
    this.write(db);
    return claimed;
  }
  async releasePayment(payment) { await this.savePayment(payment); }
  async deletePayment(id) {
    const db = this.read();
    delete db.payments[id];
    this.write(db);
  }
  async markReceiptNotified(id) {
    const db = this.read();
    if (db.payments[id]) db.payments[id].receipt_notified = true;
    this.write(db);
  }
  async listPayments(userId, product) {
    return Object.values(this.read().payments)
      .filter(p => p.user_id === userId && (!product || p.product === product))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}
module.exports = { JsonStore };
