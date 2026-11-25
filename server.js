// שרת מערכת ההגרלה — מרק אוטומציות
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const store = require('./db');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const INGEST_KEY = process.env.INGEST_KEY || '';
const TICKET_PRICE = Number(process.env.TICKET_PRICE || 150);
const SESSION_DAYS = 7;

if (!ADMIN_PASSWORD) console.warn('[אזהרה] ADMIN_PASSWORD לא הוגדר — הכניסה לדשבורד חסומה');
if (!process.env.SESSION_SECRET) console.warn('[אזהרה] SESSION_SECRET לא הוגדר — ההתחברויות יתנתקו בכל הפעלה מחדש');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

/* ---------- עזרים ---------- */
const normPhone = p => String(p || '').replace(/\D/g, '');
const validPhone = p => /^0\d{8,9}$/.test(p);
const validCode = c => /^[A-Za-z0-9]{2,20}$/.test(c);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/* ---------- התחברות (עוגייה חתומה) ---------- */
const sign = v => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('base64url');
function makeToken() {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  return `${exp}.${sign(String(exp))}`;
}
function validToken(t) {
  if (!t) return false;
  const [exp, sig] = t.split('.');
  return !!exp && !!sig && Number(exp) > Date.now() && safeEq(sig, sign(exp));
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
function requireAdmin(req, res, next) {
  if (validToken(getCookie(req, 'rs_session'))) return next();
  return bad(res, 'נדרשת התחברות', 401);
}

// הגבלת ניסיונות כניסה פשוטה לפי IP
const loginTries = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const t = loginTries.get(ip) || { n: 0, until: 0 };
  if (t.until > Date.now()) return bad(res, 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות', 429);
  if (!ADMIN_PASSWORD || !safeEq(req.body?.password || '', ADMIN_PASSWORD)) {
    t.n++; if (t.n >= 5) { t.until = Date.now() + 10 * 60e3; t.n = 0; }
    loginTries.set(ip, t);
    return bad(res, 'סיסמה שגויה', 401);
  }
  loginTries.delete(ip);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `rs_session=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'rs_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ loggedIn: validToken(getCookie(req, 'rs_session')) }));

/* ---------- שגרירים (מנהל) ---------- */
app.get('/api/ambassadors', requireAdmin, (req, res) => {
  const visits = store.visitCounts();
  res.json(store.listAmbassadors().map(a => ({ ...a, visits: visits[a.code.toLowerCase()] || 0 })));
});

app.post('/api/ambassadors/save', requireAdmin, (req, res) => {
  const b = req.body || {};
  const a = {
    id: b.id ? String(b.id) : '',
    name: String(b.name || '').trim().slice(0, 80),
    phone: normPhone(b.phone),
    code: String(b.code || '').trim(),
    target: Math.max(0, parseInt(b.target) || 0),
    active: !!b.active,
  };
  if (!a.name) return bad(res, 'יש להזין שם');
  if (!validPhone(a.phone)) return bad(res, 'מספר טלפון לא תקין');
  if (!validCode(a.code)) return bad(res, 'קוד לא תקין — אותיות באנגלית וספרות בלבד');
  const clash = store.ambassadorByCode(a.code);
  if (clash && clash.id !== a.id) return bad(res, 'הקוד כבר בשימוש אצל שגריר אחר');
  if (a.id && !store.getAmbassador(a.id)) return bad(res, 'השגריר לא נמצא', 404);
  const saved = store.saveAmbassador(a);
  res.json({ ...saved, active: !!saved.active });
});

app.post('/api/ambassadors/delete', requireAdmin, (req, res) => {
  const a = store.getAmbassador(String(req.body?.id || ''));
  if (!a) return bad(res, 'השגריר לא נמצא', 404);
  if (store.salesCountForRef(a.code) > 0) return bad(res, 'לא ניתן למחוק שגריר עם מכירות — אפשר לסמן כלא פעיל', 409);
  store.deleteAmbassador(a.id);
  res.json({ ok: true });
});

/* ---------- מכירות (מנהל) ---------- */
app.get('/api/sales', requireAdmin, (req, res) => res.json(store.listSales()));

/* ---------- ציבורי: לדף הנחיתה ולקו הטלפוני ---------- */
// בדיקת קוד שגריר (דף נחיתה / IVR). מחזיר שם פרטי בלבד.
app.get('/api/public/ref/:code', (req, res) => {
  const a = store.ambassadorByCode(req.params.code);
  if (!a || !a.active) return res.json({ valid: false });
  res.json({ valid: true, code: a.code, first_name: a.name.split(' ')[0] });
});

// רישום כניסה לקישור אישי (נקרא מדף הנחיתה כשיש ?ref=)
const visitSeen = new Map(); // מניעת ספירה כפולה: IP+קוד, פעם בשעה
app.post('/api/public/visit', (req, res) => {
  const ref = String(req.body?.ref || '').trim();
  const a = validCode(ref) && store.ambassadorByCode(ref);
  if (!a) return res.json({ ok: false });
  const key = req.ip + '|' + a.code.toLowerCase();
  const last = visitSeen.get(key) || 0;
  if (Date.now() - last > 3600e3) { store.addVisit(a.code); visitSeen.set(key, Date.now()); }
  if (visitSeen.size > 50000) visitSeen.clear();
  res.json({ ok: true });
});

/* ---------- קליטת מכירה (פנימי: דף נחיתה אחרי סליקה / IVR / callback מנדרים) ---------- */
// דורש כותרת X-Ingest-Key. מספר כרטיס נוצר אוטומטית.
app.post('/api/sales/ingest', (req, res) => {
  if (!INGEST_KEY || !safeEq(req.get('X-Ingest-Key') || '', INGEST_KEY)) return bad(res, 'אין הרשאה', 401);
  const b = req.body || {};
  const buyer_phone = normPhone(b.buyer_phone);
  const channel = b.channel === 'phone' ? 'phone' : 'web';
  const amount = parseInt(b.amount) || TICKET_PRICE;
  const buyer_name = String(b.buyer_name || '').trim().slice(0, 80);
  if (!buyer_name) return bad(res, 'חסר שם קונה');
  if (!validPhone(buyer_phone)) return bad(res, 'טלפון קונה לא תקין');
  let ref = String(b.ref || '').trim();
  const amb = ref && store.ambassadorByCode(ref);
  ref = amb ? amb.code : (validCode(ref) ? ref : ''); // שומרים קוד לא מוכר לבדיקה ידנית
  const { sale, duplicate } = store.createSale({ buyer_name, buyer_phone, amount, ref, channel, payment_ref: b.payment_ref ? String(b.payment_ref) : null });
  res.json({ ok: true, duplicate, ticket_no: sale.ticket_no, ambassador: amb ? amb.name : null });
});

/* ---------- סטטי ---------- */
app.get('/health', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: '5m' }));
app.use((req, res) => bad(res, 'לא נמצא', 404));
app.use((err, req, res, next) => { console.error(err); bad(res, 'שגיאת שרת', 500); });

app.listen(PORT, () => console.log(`raffle-server listening on :${PORT}`));
