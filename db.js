// שכבת נתונים — SQLite מובנה של Node (node:sqlite)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'raffle.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS ambassadors (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL,
    code       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    target     INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    created    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sales (
    id           TEXT PRIMARY KEY,
    ticket_no    INTEGER NOT NULL UNIQUE,
    buyer_name   TEXT NOT NULL,
    buyer_phone  TEXT NOT NULL,
    amount       INTEGER NOT NULL,
    ref          TEXT NOT NULL DEFAULT '',
    channel      TEXT NOT NULL CHECK (channel IN ('web','phone')),
    payment_ref  TEXT UNIQUE,              -- מזהה עסקה בנדרים פלוס (מונע כפילויות)
    date         TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sales_ref ON sales(ref);

  CREATE TABLE IF NOT EXISTS visits (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    ref   TEXT NOT NULL,
    date  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_visits_ref ON visits(ref);
`);

const FIRST_TICKET = Number(process.env.FIRST_TICKET_NO || 100001);
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

const q = {
  listAmb:   db.prepare(`SELECT id,name,phone,code,target,active,created FROM ambassadors ORDER BY created`),
  getAmb:    db.prepare(`SELECT * FROM ambassadors WHERE id = ?`),
  ambByCode: db.prepare(`SELECT * FROM ambassadors WHERE code = ? COLLATE NOCASE`),
  insAmb:    db.prepare(`INSERT INTO ambassadors (id,name,phone,code,target,active,created) VALUES (?,?,?,?,?,?,?)`),
  updAmb:    db.prepare(`UPDATE ambassadors SET name=?, phone=?, code=?, target=?, active=? WHERE id=?`),
  delAmb:    db.prepare(`DELETE FROM ambassadors WHERE id = ?`),
  salesForRef: db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE ref = ? COLLATE NOCASE`),

  listSales: db.prepare(`SELECT id,ticket_no,buyer_name,buyer_phone,amount,ref,channel,date FROM sales ORDER BY ticket_no DESC`),
  maxTicket: db.prepare(`SELECT MAX(ticket_no) AS m FROM sales`),
  saleByPay: db.prepare(`SELECT * FROM sales WHERE payment_ref = ?`),
  insSale:   db.prepare(`INSERT INTO sales (id,ticket_no,buyer_name,buyer_phone,amount,ref,channel,payment_ref,date) VALUES (?,?,?,?,?,?,?,?,?)`),

  insVisit:  db.prepare(`INSERT INTO visits (ref,date) VALUES (?,?)`),
  visitCounts: db.prepare(`SELECT ref, COUNT(*) AS n FROM visits GROUP BY ref COLLATE NOCASE`),
};

module.exports = {
  db,
  listAmbassadors: () => q.listAmb.all().map(a => ({ ...a, active: !!a.active })),
  getAmbassador: id => q.getAmb.get(id),
  ambassadorByCode: code => q.ambByCode.get(String(code || '')),
  salesCountForRef: code => q.salesForRef.get(code).n,

  saveAmbassador(a) {
    const existing = a.id ? q.getAmb.get(a.id) : null;
    if (existing) {
      q.updAmb.run(a.name, a.phone, a.code, a.target, a.active ? 1 : 0, a.id);
      return { ...existing, ...a };
    }
    const row = { ...a, id: uid(), created: now() };
    q.insAmb.run(row.id, row.name, row.phone, row.code, row.target, row.active ? 1 : 0, row.created);
    return row;
  },
  deleteAmbassador: id => q.delAmb.run(id),

  listSales: () => q.listSales.all(),

  // יצירת מכירה — מספר כרטיס רץ, ומניעת כפילות לפי מזהה עסקה
  createSale({ buyer_name, buyer_phone, amount, ref, channel, payment_ref }) {
    if (payment_ref) {
      const dup = q.saleByPay.get(payment_ref);
      if (dup) return { sale: dup, duplicate: true };
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const m = q.maxTicket.get().m;
      const ticket_no = m ? m + 1 : FIRST_TICKET;
      const sale = { id: uid(), ticket_no, buyer_name, buyer_phone, amount, ref: ref || '', channel, payment_ref: payment_ref || null, date: now() };
      q.insSale.run(sale.id, sale.ticket_no, sale.buyer_name, sale.buyer_phone, sale.amount, sale.ref, sale.channel, sale.payment_ref, sale.date);
      db.exec('COMMIT');
      return { sale, duplicate: false };
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },

  addVisit: ref => q.insVisit.run(ref, now()),
  visitCounts: () => Object.fromEntries(q.visitCounts.all().map(r => [r.ref.toLowerCase(), r.n])),
};
