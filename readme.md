# 🧸 How Well Do You Know Me?

A cute, animated friend-quiz web app. You answer 30 questions about yourself, share one link, and every friend gets 10 of them. Their score, their answers and who was only guessing are all waiting for you afterwards.

Built with **Node.js + Express** and a single-file vanilla JavaScript front end. No build step, no framework, no database server to manage.

---

## ✨ Features

**For the quiz maker**
- Create a quiz in three steps: name → gender → quiz language
- Answer 30 built-in questions, each with 6 picture options and exactly one choice
- Add your own questions (2–6 options, text only, up to 50)
- Share by WhatsApp, Instagram, Snapchat, Facebook, Messenger, Telegram or any app. The link is copied automatically as a fallback
- **Scores dashboard:** names list → pick a friend → pick a try → review one question per page with pictures, ✅ / ❌ and the correct option

**For friends**
- Open the link, enter name, gender and relationship (Father, Mother, Brother, Sister, Daughter, Friend, Boyfriend, Girlfriend, One-side love)
- Answer **10 questions**, one option each
- Instant feedback: green ✅ if right; red ❌ plus the right answer if wrong. Answers lock once chosen
- Playing again gives **new questions** the friend has not seen. Questions repeat only after the whole pool is used

**Language**
- 10 languages: English, Hindi, Japanese, Korean, Spanish, French, German, Italian, Arabic, Filipino
- The quiz maker picks the language. Friends see everything in that language and cannot change it
- Right-to-left layout for Arabic

**Look and feel**
- 3D-style bear and panda mascots that blink, wave, follow your finger or mouse and react (happy or sad) to each answer
- Gummy cards, jelly buttons, floating balloons, confetti
- Respects `prefers-reduced-motion`

---

## 🧱 Tech stack

| Layer | Choice |
|---|---|
| Server | Node.js ≥ 18, Express 4 |
| Front end | One `public/index.html` (vanilla JS, CSS animations, inline SVG mascots) |
| Storage (local) | JSON file at `data/db.json` |
| Storage (production) | Upstash Redis through its REST API |
| Hosting | Vercel (`vercel.json` included) or any Node host |

---

## 🚀 Run locally

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Quizzes are stored in `data/db.json`, created automatically. To let friends open your local quiz from their phones, forward port 3000 (for example with the VS Code **Ports** tab, visibility **Public**) and create the quiz from the forwarded address. The share link uses whatever address the site was opened from.

---

## ☁️ Deploy to Vercel

Vercel cannot keep files between requests, so a hosted Redis is required.

1. Push this repo to GitHub.
2. In Vercel choose **Add New → Project** and import the repo. No build settings needed; `vercel.json` handles routing and bundles `public/`, `questions.json` and `translations.json`.
3. In the project's **Storage / Marketplace** add **Upstash Redis**. It sets these environment variables for you:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

   (`KV_REST_API_URL` and `KV_REST_API_TOKEN` are also supported.)
4. **Redeploy**, then create a quiz from your Vercel URL and test the share link on a phone.

Without Redis on Vercel, creating a quiz returns a clear error instead of silently losing data.

---

## 🗂 Project structure

```
.
├── public/
│   └── index.html        # the whole front end (UI, mascots, translations of the interface)
├── server.js             # Express API + storage layer
├── questions.json        # 30 base questions: id, text, 6 options, 6 icons
├── translations.json     # question text/options per language
├── vercel.json           # Vercel routing and bundled files
├── package.json
└── data/                 # local database (git-ignored, created at runtime)
```

Recommended `.gitignore`:

```
node_modules/
data/
.env
```

---

## ➕ Adding questions

Edit `questions.json` and append an entry. Each question needs a **unique `id`**, exactly **6 options** and 6 matching **icons** (an emoji, or an image path such as `/images/pizza.jpg` placed in `public/images/`):

```json
{
  "id": "q31",
  "text": "What is my favourite fruit?",
  "options": ["Mango", "Apple", "Banana", "Grapes", "Orange", "Watermelon"],
  "ic": ["🥭", "🍎", "🍌", "🍇", "🍊", "🍉"]
}
```

Then add its translations in `translations.json`, keyed by the same id. **Keep the options in the same order in every language**, because answers are stored by option position:

```json
"q31": {
  "en": { "text": "What is my favourite fruit?", "options": ["Mango", "Apple", "Banana", "Grapes", "Orange", "Watermelon"] },
  "hi": { "text": "मेरा पसंदीदा फल कौन सा है?", "options": ["आम", "सेब", "केला", "अंगूर", "संतरा", "तरबूज"] }
}
```

Restart the server. A quiz maker who already finished their 30 answers must press **Answer my 30 again** to answer the new question.

> `questions.json` is checked at startup. A question without exactly 6 options or with a duplicate id prints a warning in the console.

## 🌍 Adding or editing a language

- **Questions:** add a block for the language code (`ja`, `ko`, `es`, `fr`, `de`, `it`, `ar`, `fil`, …) to each question in `translations.json`. A missing language falls back to English.
- **Interface text:** add a `T.<code> = { ... }` block in `public/index.html`, copying the `en` keys. Missing keys fall back to English.

---

## 🔌 API overview

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/quiz` | Create a quiz (`name`, `gender`, `lang`) → `id`, `token` |
| `GET` | `/api/quiz/:id` | Public info: name, gender, language, ready |
| `GET` | `/api/quiz/:id/me?token=` | Owner view: custom questions and detailed results |
| `GET` | `/api/base-questions?lang=` | The 30 base questions in a language |
| `POST` | `/api/quiz/:id/answers` | Owner submits answers to the 30 questions |
| `POST` | `/api/quiz/:id/reset` | Owner clears their 30 answers |
| `POST` / `DELETE` | `/api/quiz/:id/custom[/:cid]` | Add or remove a custom question |
| `POST` | `/api/quiz/:id/start` | Friend starts an attempt, gets 10 unseen questions |
| `POST` | `/api/attempt/:aid/answer` | Friend answers one question, gets the correct option back, answer locks |
| `POST` | `/api/attempt/:aid/submit` | Finish the attempt and get the score |

---

## 🔐 How it behaves

- **Owner access** is a random token stored in the creator's browser (`localStorage`). Bookmark your `/me/<id>` page. If browser storage is cleared, you lose access to that quiz's dashboard
- **Friend identity** is a random id stored in the friend's browser. This is what makes retries get new questions
- **Correct answers never reach friends** until they have answered that question
- **Data stored:** quiz maker's name, gender, language and answers; each friend's name, gender, relationship and answers. No emails, passwords or accounts
- Quiz data is stored one document per quiz. If two friends finish at the exact same instant, the later write can overwrite the earlier one. This is acceptable for friend-group use, not for heavy traffic

---

## 🛠 Troubleshooting

| Problem | Fix |
|---|---|
| `npm is not recognized` | Install Node.js LTS, then fully restart VS Code |
| Share link opens `localhost` on friends' phones | Create the quiz from the public (forwarded or Vercel) address |
| "Database connect nahi hai" on Vercel | Add Upstash Redis and redeploy |
| Old quizzes broken after an update | Delete the local `data/` folder |

---

## 📄 License

Choose a license for your repository (for example MIT) and add a `LICENSE` file.