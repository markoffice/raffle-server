# מערכת הגרלת רכב — שרת

שרת Node.js עם SQLite (מובנה ב-Node 22). הוא מגיש את דשבורד ניהול ההפניות ואת ה-API לדף הנחיתה, לקו הטלפוני ולסליקה.

## הרצה מקומית
```
npm install
copy .env.example .env      (ולמלא ערכים)
set ADMIN_PASSWORD=... && set SESSION_SECRET=... && set INGEST_KEY=... && npm start
```
הדשבורד: http://localhost:3000/admin · דף הנחיתה: http://localhost:3000

## העלאה ל-CapRover
1. יוצרים אפליקציה חדשה, למשל `raffle`.
2. מפעילים **Persistent Data**, עם Path in App: `/app/data`. בלי זה, מסד הנתונים יימחק בכל עדכון.
3. ב-App Configs מגדירים משתני סביבה: `ADMIN_PASSWORD`, `SESSION_SECRET`, `INGEST_KEY`, ובמידת הצורך גם `TICKET_PRICE`, `FIRST_TICKET_NO` ו-`LANDING_URL` (כתובת הבסיס של הקישורים האישיים. אם לא מוגדר, נלקחת כתובת השרת).
4. HTTP Port של הקונטיינר: `3000`.
5. מפעילים HTTPS ומעלים: `caprover deploy`, או גוררים את קובץ ה-tar ב-Deployment.

## Endpoints

| נתיב | הרשאה | תפקיד |
|---|---|---|
| `POST /api/login` / `logout` | — | כניסה לדשבורד (עוגייה ל-7 ימים) |
| `GET /api/ambassadors` | מנהל | רשימת שגרירים כולל ספירת כניסות |
| `POST /api/ambassadors/save` | מנהל | הוספה או עריכה |
| `POST /api/ambassadors/delete` | מנהל | מחיקה, רק לשגריר בלי מכירות |
| `GET /api/sales` | מנהל | כל המכירות |
| `GET /api/public/ref/:code` | ציבורי | בדיקת קוד שגריר, לדף הנחיתה ולקו הטלפוני |
| `POST /api/public/visit` | ציבורי | `{ref}` — רישום כניסה לקישור אישי (פעם בשעה לכל IP) |
| `POST /api/sales/ingest` | `X-Ingest-Key` | קליטת מכירה אחרי סליקה. מחזיר מספר כרטיס |

### גוף הבקשה ל-ingest
```json
{ "buyer_name": "ישראל כץ", "buyer_phone": "0541234567", "ref": "1001",
  "channel": "web", "payment_ref": "מזהה עסקה בנדרים", "amount": 150 }
```
אם נשלח `payment_ref` שכבר קיים, לא נוצר כרטיס חדש, והשרת מחזיר את הכרטיס הקיים עם `duplicate: true`.
אם נשלח קוד שגריר לא מוכר, הוא נשמר כמו שהוא ומסומן בדשבורד לבדיקה ידנית.
