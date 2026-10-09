const express = require('express'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PER_ATTEMPT = 10;
const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));
const ids = new Set();
BASE.forEach(q => {
  if (!q.id || !q.text || !Array.isArray(q.options) || q.options.length !== 6 || ids.has(q.id))
    console.warn('⚠ questions.json problem (6 options + unique id needed):', q.id || q.text);
  ids.add(q.id);
});
const LANGS = ['en','hi','ja','ko','es','fr','de','it','ar','fil'];
const RELS = ['father','mother','brother','sister','daughter','friend','boyfriend','girlfriend','oneside'];
const TRF = path.join(__dirname, 'translations.json');
const TR = fs.existsSync(TRF) ? JSON.parse(fs.readFileSync(TRF, 'utf8')) : {};
// Base sawaal: language translations.json se; na mile to English; English na ho to questions.json (Hinglish)
const tx = (q, lang) => {
  if (q.id.startsWith('c_')) return q;
  const t = TR[q.id] || {};
  return Object.assign({}, q, t[lang] || t.en || {});
};
const pub = (q, lang) => { const v = tx(q, lang); return { id: v.id, text: v.text, ic: v.ic || null, options: v.options }; };

// ---------- Storage: local = data/db.json, Vercel = Upstash Redis (REST) ----------
// Variable ka naam kisi bhi prefix ke saath ho sakta hai (jaise GK_KV_REST_API_URL), isliye naam se dhundhte hain
const envFind = re => { const k = Object.keys(process.env).find(n => re.test(n)); return k ? process.env[k] : undefined; };
const RURL = envFind(/(^|_)(KV_REST_API_URL|UPSTASH_REDIS_REST_URL)$/);
const RTOK = envFind(/(^|_)(KV_REST_API_TOKEN|UPSTASH_REDIS_REST_TOKEN)$/);
const FILE = path.join(__dirname, 'data', 'db.json');
let mem = null;
const load = () => { if (!mem) { mem = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {}; if (mem.quizzes) mem = {}; } };
const redis = async cmd => {
  const r = await fetch(RURL, { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK }, body: JSON.stringify(cmd) });
  const j = await r.json(); if (j.error) throw new Error(j.error); return j.result;
};
const store = RURL ? {
  async get(id) { const v = await redis(['GET', 'quiz:' + id]); return v ? JSON.parse(v) : null; },
  async set(id, doc) { await redis(['SET', 'quiz:' + id, JSON.stringify(doc)]); }
} : {
  async get(id) { load(); return mem[id] || null; },
  async set(id, doc) {
    if (process.env.VERCEL) throw new Error('Database connect nahi hai (Vercel par Upstash Redis jodna zaroori hai)');
    load(); mem[id] = doc; fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(mem));
  }
};

const rid = n => crypto.randomBytes(n).toString('base64url');
const shuffle = a => a.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
const fail = (res, msg, code = 400) => res.status(code).json({ error: msg });
const H = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => { console.error(e); fail(res, e.message || 'Server error', 500); });
const pool = qz => [...BASE, ...qz.custom];
const ready = qz => BASE.every(q => Number.isInteger(qz.answers[q.id]));
const clean = s => String(s || '').trim().slice(0, 150);
const rightOf = (qz, q) => q.id.startsWith('c_') ? q.answer : qz.answers[q.id];

async function quiz(req, res, id = req.params.id) {
  const qz = await store.get(id);
  if (!qz) fail(res, 'Quiz nahi mila', 404);
  return qz;
}
async function owner(req, res) {
  const qz = await quiz(req, res); if (!qz) return null;
  if ((req.query.token || (req.body || {}).token) !== qz.token) { fail(res, 'Ye quiz tumhara nahi hai', 403); return null; }
  return qz;
}

app.get('/api/base-questions', (req, res) => res.json({ questions: BASE.map(q => pub(q, req.query.lang)) }));

app.post('/api/quiz', H(async (req, res) => {
  const name = clean(req.body.name).slice(0, 30);
  if (!name) return fail(res, 'Naam likho');
  const id = rid(5), token = rid(12);
  const gender = req.body.gender === 'female' ? 'female' : 'male';
  const lang = LANGS.includes(req.body.lang) ? req.body.lang : 'en';
  await store.set(id, { id, name, gender, lang, token, answers: {}, custom: [], attempts: {} });
  res.json({ id, token });
}));

app.get('/api/quiz/:id', H(async (req, res) => {
  const qz = await quiz(req, res); if (!qz) return;
  res.json({ name: qz.name, gender: qz.gender, lang: qz.lang, ready: ready(qz) });
}));

app.get('/api/quiz/:id/me', H(async (req, res) => {
  const qz = await owner(req, res); if (!qz) return;
  const byId = Object.fromEntries(pool(qz).map(q => [q.id, tx(q, qz.lang)]));
  const done = Object.values(qz.attempts).filter(a => a.done).sort((a, b) => b.at - a.at);
  const tries = {}; done.forEach(a => tries[a.pid] = (tries[a.pid] || 0) + 1);
  const qstats = {};
  const results = done.map(a => ({
    pid: a.pid, player: a.player, gender: a.gender, relation: a.relation, score: a.score, total: a.qids.length, at: a.at, tries: tries[a.pid],
    items: a.qids.filter(id => byId[id]).map(id => {
      const r = rightOf(qz, byId[id]), c = a.answers[id], ok = c === r;
      const s = qstats[id] = qstats[id] || { asked: 0, ok: 0 }; s.asked++; if (ok) s.ok++;
      return { id, chosen: c, right: r, ok };
    })
  }));
  const qs = Object.fromEntries(Object.entries(byId).map(([id, q]) => [id, { text: q.text, options: q.options, ic: q.ic || null }]));
  res.json({ name: qz.name, gender: qz.gender, lang: qz.lang, ready: ready(qz), custom: qz.custom, results, qs, qstats });
}));

app.post('/api/quiz/:id/answers', H(async (req, res) => {
  const qz = await owner(req, res); if (!qz) return;
  const a = req.body.answers || {};
  for (const q of BASE) if (!Number.isInteger(a[q.id]) || a[q.id] < 0 || a[q.id] >= q.options.length) return fail(res, 'Saare sawaalon ka jawab do');
  qz.answers = Object.fromEntries(BASE.map(q => [q.id, a[q.id]]));
  await store.set(qz.id, qz); res.json({ ok: true });
}));

app.post('/api/quiz/:id/reset', H(async (req, res) => {
  const qz = await owner(req, res); if (!qz) return;
  qz.answers = {}; await store.set(qz.id, qz); res.json({ ok: true });
}));

app.post('/api/quiz/:id/custom', H(async (req, res) => {
  const qz = await owner(req, res); if (!qz) return;
  const text = clean(req.body.text);
  const options = (req.body.options || []).map(o => String(o || '').trim().slice(0, 60)).filter(Boolean);
  const answer = req.body.answer;
  if (!text) return fail(res, 'Sawaal likho');
  if (options.length < 2 || options.length > 6) return fail(res, 'Options 2 se 6 ke beech hone chahiye');
  if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) return fail(res, 'Sahi jawab chuno');
  if (qz.custom.length >= 50) return fail(res, 'Zyada se zyada 50 apne sawaal');
  qz.custom.push({ id: 'c_' + rid(4), text, options, answer });   // custom sawaal mein picture nahi
  await store.set(qz.id, qz); res.json({ ok: true });
}));

app.delete('/api/quiz/:id/custom/:cid', H(async (req, res) => {
  const qz = await owner(req, res); if (!qz) return;
  qz.custom = qz.custom.filter(c => c.id !== req.params.cid);
  await store.set(qz.id, qz); res.json({ ok: true });
}));

// Dost: 10 sawaal, creator ki language mein, jo is dost ko pehle nahi mile
app.post('/api/quiz/:id/start', H(async (req, res) => {
  const qz = await quiz(req, res); if (!qz) return;
  if (!ready(qz)) return fail(res, 'Quiz abhi ready nahi hai');
  const pid = String(req.body.pid || '').slice(0, 40), player = clean(req.body.player).slice(0, 30);
  const gender = req.body.gender === 'female' ? 'female' : 'male', relation = req.body.relation;
  if (!pid || !player) return fail(res, 'Naam likho');
  if (!RELS.includes(relation)) return fail(res, 'Relationship chuno');
  const all = pool(qz);
  const seen = new Set(Object.values(qz.attempts).filter(a => a.pid === pid).flatMap(a => a.qids));
  const fresh = shuffle(all.filter(q => !seen.has(q.id)));
  const qs = fresh.concat(shuffle(all.filter(q => seen.has(q.id)))).slice(0, PER_ATTEMPT);
  const attempt = qz.id + '.' + rid(6);
  qz.attempts[attempt] = { id: attempt, pid, player, gender, relation, qids: qs.map(q => q.id), answers: {}, done: false, at: Date.now() };
  await store.set(qz.id, qz);
  res.json({ attempt, questions: qs.map(q => pub(q, qz.lang)) });
}));

// Ek sawaal ka jawab: turant sahi option bata deta hai, aur jawab lock ho jata hai
app.post('/api/attempt/:aid/answer', H(async (req, res) => {
  const qz = await quiz(req, res, req.params.aid.split('.')[0]); if (!qz) return;
  const at = qz.attempts[req.params.aid];
  if (!at || at.done) return fail(res, 'Attempt nahi mila', 404);
  const { qid, choice } = req.body;
  const q = pool(qz).find(x => x.id === qid);
  if (!q || !at.qids.includes(qid)) return fail(res, 'Ye sawaal is attempt ka nahi hai');
  if (at.answers[qid] !== undefined) return fail(res, 'Is sawaal ka jawab ho chuka hai');
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return fail(res, 'Ek option chuno');
  at.answers[qid] = choice;
  await store.set(qz.id, qz);
  res.json({ right: rightOf(qz, q) });
}));

app.post('/api/attempt/:aid/submit', H(async (req, res) => {
  const qz = await quiz(req, res, req.params.aid.split('.')[0]); if (!qz) return;
  const at = qz.attempts[req.params.aid];
  if (!at) return fail(res, 'Attempt nahi mila', 404);
  if (at.done) return fail(res, 'Ye attempt pehle hi khatam ho chuka hai');
  const byId = Object.fromEntries(pool(qz).map(q => [q.id, q]));
  let score = 0;
  for (const id of at.qids) {
    if (at.answers[id] === undefined) return fail(res, 'Saare 10 sawaalon ka jawab do');
    if (at.answers[id] === rightOf(qz, byId[id])) score++;
  }
  Object.assign(at, { done: true, score, at: Date.now() });
  await store.set(qz.id, qz);
  res.json({ score, total: at.qids.length });
}));

app.get(['/me/:id', '/q/:id'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

module.exports = app;
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => console.log(`Chal raha hai: http://localhost:${PORT}  (sawaal: ${BASE.length})`));
}
