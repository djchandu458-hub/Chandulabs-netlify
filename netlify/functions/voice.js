// netlify/functions/voice.js
// Chat + TTS Netlify function for ChanduLabs
// Flow:
// 1) Receive POST JSON { text, language, mode }
// 2) Call Generative Text API (Gemini / PaLM) to get reply text
// 3) Send reply text to RVC server (if configured) or Gemini TTS as fallback
// 4) Return base64 WAV (isBase64Encoded: true)
// Env vars:
// - GEMINI_API_KEY  (required for text & TTS)
// - RVC_SERVER_URL  (optional; when set, will be used for cloned voice synthesis)
// - GEMINI_TTS_URL (optional override for TTS endpoint)

const SAMPLE_RATE = 24000;

// Helper responses
function jsonError(status, obj) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj)
  };
}
function base64Response(base64) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'audio/wav', 'Access-Control-Allow-Origin': '*' },
    body: base64,
    isBase64Encoded: true
  };
}

// Attempt to extract text from various possible Gemini/PaLM response shapes
function extractReplyText(json) {
  // Common variants across samples / SDKs:
  // - json.candidates[0].output or .content or .display
  // - json.output[0].content[0].text
  // - json.text (simple SDK wrappers)
  try {
    if (!json) return null;
    if (typeof json === 'string') return json;
    if (json.result && typeof json.result === 'string') return json.result;
    if (json.output && Array.isArray(json.output) && json.output.length) {
      const out = json.output[0];
      if (typeof out === 'string') return out;
      if (out.content && Array.isArray(out.content) && out.content.length) {
        // content blocks may contain {type:'text', text:'...'} or simple strings
        for (const c of out.content) {
          if (c && (c.text || c.raw || c.trim)) return (c.text || c.raw || String(c)).toString();
          if (typeof c === 'string' && c.trim()) return c;
        }
      }
      if (out.text) return out.text;
    }
    if (json.candidates && Array.isArray(json.candidates) && json.candidates.length) {
      const cand = json.candidates[0];
      if (cand.outputText) return cand.outputText;
      if (cand.content && typeof cand.content === 'string') return cand.content;
      if (cand.message && (cand.message.contentText || cand.message.content)) {
        return cand.message.contentText || cand.message.content;
      }
      if (cand.display) return cand.display;
    }
    if (json.text) return json.text;
    if (json.message && json.message.content && typeof json.message.content === 'string') return json.message.content;
    // last resort: stringify parts
    return JSON.stringify(json).slice(0, 2000);
  } catch (e) {
    return null;
  }
}

// Call Google Generative Text endpoint (v1beta2 generativelanguage URL)
async function callGenerativeText(prompt, apiKey) {
  // We use the standard Generative Language REST endpoint for text models.
  // This is compatible with PaLM/Generative API: generativelanguage.googleapis.com/v1beta2/models/<model>:generateText
  // We'll call a widely-available model name; you may change model name via GEMINI_MODEL env if desired.
  const model = process.env.GEMINI_MODEL || 'text-bison-001';
  const url = `https://generativelanguage.googleapis.com/v1beta2/models/${encodeURIComponent(model)}:generateText`;

  const body = { prompt: { text: prompt } };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    // note: no timeout control here; Netlify may enforce function timeout limits.
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '<no body>');
    throw { code: 'generative_fail', status: resp.status, details: txt };
  }
  const j = await resp.json().catch(() => null);
  const reply = extractReplyText(j);
  if (!reply) {
    // As a fallback, try a simple text field
    if (j && j.candidates && j.candidates[0]) {
      return String(j.candidates[0].content || j.candidates[0].outputText || JSON.stringify(j.candidates[0])).slice(0,2000);
    }
    return String(JSON.stringify(j)).slice(0,2000);
  }
  return reply;
}

exports.handler = async function (event, context) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonError(405, { error: 'Only POST allowed' });
    }

    // Parse body
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (e) {
      return jsonError(400, { error: 'Invalid JSON', details: String(e).slice(0,300) });
    }

    const userText = (body.text || '').trim();
    const language = body.language || 'en';
    const mode = body.mode || 'cloned';

    if (!userText) return jsonError(400, { error: 'Missing text' });

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
    const RVC_SERVER_URL = (process.env.RVC_SERVER_URL || '').replace(/\/$/, '');
    const GEMINI_TTS_URL = process.env.GEMINI_TTS_URL || 'https://api.generativeai.googleapis.com/v1beta2/speech:generate';

    if (!GEMINI_API_KEY) {
      return jsonError(500, { error: 'GEMINI_API_KEY not configured' });
    }

    // 1) Generate reply text via Gemini / PaLM
    let replyText;
    try {
      // you can craft a prompt that instructs the assistant to reply in the same language, short, etc.
      const prompt = `You are a helpful assistant. Reply in the same language as the user. User: ${userText}`;
      replyText = await callGenerativeText(prompt, GEMINI_API_KEY);
    } catch (err) {
      // err may be an object we threw
      return jsonError(502, { error: 'Generative text failed', details: err && (err.details || err.message || JSON.stringify(err)) });
    }

    // 2) Synthesize replyText to audio
    // If mode === 'cloned' and RVC server is configured, proxy to RVC server first
    if (mode === 'cloned' && RVC_SERVER_URL) {
      try {
        const rvcResp = await fetch(`${RVC_SERVER_URL}/synthesize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: replyText, language })
        });

        if (!rvcResp.ok) {
          const t = await rvcResp.text().catch(()=>'<no body>');
          return jsonError(502, { error: 'RVC server failed', status: rvcResp.status, details: t.slice(0,300) });
        }

        const ab = await rvcResp.arrayBuffer();
        const buf = Buffer.from(ab);
        return base64Response(buf.toString('base64'));
      } catch (e) {
        return jsonError(502, { error: 'RVC connection error', details: String(e).slice(0,300) });
      }
    }

    // Fallback: use Gemini TTS for the reply text
    const tBody = {
      input: { text: replyText },
      audio: { encoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE }
    };

    try {
      const gResp = await fetch(GEMINI_TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GEMINI_API_KEY}` },
        body: JSON.stringify(tBody)
      });

      if (!gResp.ok) {
        const txt = await gResp.text().catch(()=>'<no body>');
        return jsonError(502, { error: 'Gemini TTS failed', status: gResp.status, details: txt.slice(0,300) });
      }

      const gab = await gResp.arrayBuffer();
      const gb = Buffer.from(gab);
      return base64Response(gb.toString('base64'));
    } catch (err) {
      return jsonError(502, { error: 'Gemini TTS request error', details: String(err).slice(0,300) });
    }

  } catch (e) {
    return jsonError(500, { error: 'Internal error', details: String(e).slice(0,300) });
  }
};
