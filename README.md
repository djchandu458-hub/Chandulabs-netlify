# ChanduLabs – Live Talking AI with Your Cloned Voice  
A lightweight ElevenLabs-style system that lets you type or speak, and replies in **your cloned voice**, in multiple Indian languages.

This project uses:
- A **Colab-hosted RVC / Gemini TTS server** for generating your voice  
- A **Netlify-hosted frontend + serverless function**  
- Multi-language support (EN, HI, TE, TA, KN, ML, BN)  
- Simple HTML + JS frontend  
- Your own cloned voice (via RVC server + Gemini API)

---

## 📁 Project Structure (Netlify)

```
index.html                        → main UI (root)
public/app.js                     → frontend logic
netlify/functions/voice.js        → backend serverless function
netlify.toml                      → Netlify configuration
package.json                      → project config
README.md                         → documentation
```

---

## 🔧 Environment Variables (Netlify)

Go to **Netlify → Site Settings → Build & Deploy → Environment Variables**  
Add:

```
RVC_SERVER_URL = https://<your-colab-public-url>
GEMINI_API_KEY = <your-gemini-api-key>
```

### Important:
- `RVC_SERVER_URL` changes every time your Colab notebook restarts.  
- Use the latest locatunnel/ngrok/serveo URL.  
- Rotate your Gemini key if it was exposed earlier.

---

## 🚀 Deployment on Netlify

1. Push files to GitHub.  
2. Go to **Netlify → Add New Site → Import From Git**.  
3. Select your repo.  
4. Deploy the site.  
5. Add environment variables (`RVC_SERVER_URL`, `GEMINI_API_KEY`).  
6. Trigger a **Redeploy**.

---

## 🛠️ How the System Works

1. Frontend sends JSON →  
   `/.netlify/functions/voice`

2. Netlify function decides:
   - If `RVC_SERVER_URL` active → forwards to your Colab RVC server → returns **your cloned voice**  
   - Else → uses **Gemini TTS fallback**

3. Function returns **base64 WAV audio**.

4. Browser converts base64 → Blob → plays audio.

---

## 🧪 Test the Voice API

Use curl:

```bash
curl -X POST https://YOUR_NETLIFY_SITE/.netlify/functions/voice \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello from ChanduLabs","language":"en","mode":"cloned"}' \
  --output output.wav
```

If `output.wav` plays → backend is correct.

---

## 🎙️ Supported Languages  
- English  
- Hindi  
- Telugu  
- Tamil  
- Kannada  
- Malayalam  
- Bengali  

---

## ❗ Troubleshooting  
- If audio doesn’t play:  
  Check browser **Console → Network → voice function response**.  
- If Netlify function returns JSON error:  
  Recheck your environment variables.  
- If Colab link expired:  
  Restart tunnel → update `RVC_SERVER_URL` → Redeploy.

---

## ❤️ Credits  
ChanduLabs UI, voice routing, and serverless design created to deliver a simple, fast AI voice experience using open tools (Netlify + Colab + Gemini).
