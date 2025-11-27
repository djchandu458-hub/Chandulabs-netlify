// netlify/functions/voice.js
// Netlify function for ChanduLabs
// Accepts POST JSON: { text, language, mode }
// Returns base64 WAV (isBase64Encoded: true)
// Requires env vars: RVC_SERVER_URL (optional), GEMINI_API_KEY (fallback)

const SAMPLE_RATE = 24000;

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

exports.handler = async function (event, context) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonError(405, { error: 'Only POST allowed' });
    }

    // Parse body (Netlify gives event.body as string)
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return jsonError(400, { error: 'Invalid JSON', details: String(e).slice(0,300) });
    }

    const text = (body.text || '').trim();
    const language = body.language || 'en';
    const mode = body.mode || 'cloned';

    if (!text) {
      return jsonError(400, { error: 'Missing text' });
    }

    const RVC_SERVER_URL = (process.env.RVC_SERVER_URL || '').replace(/\/$/, '');
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
    const GEMINI_TTS_URL = process.env.GEMINI_TTS_URL || 'https://api.generativeai.googleapis.com/v1beta2/speech:generate';

    // If cloned mode and RVC server configured, proxy to it
    if (mode === 'cloned' && RVC_SERVER_URL) {
      try {
        const url = `${RVC_SERVER_URL}/synthesize`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, language })
        });

        if (!resp.ok) {
          const txt = await resp.text().catch(() => '<no body>');
          return jsonError(502, { error: 'RVC server failed', status: resp.status, details: txt.slice(0,300) });
        }

        const ab = await resp.arrayBuffer();
        const buf = Buffer.from(ab);
        return base64Response(buf.toString('base64'));
      } catch (err) {
        return jsonError(502, { error: 'RVC connection error', details: String(err).slice(0,300) });
      }
    }

    // Fallback: Gemini TTS
    if (!GEMINI_API_KEY) {
      return jsonError(500, { error: 'No RVC_SERVER_URL configured and GEMINI_API_KEY not set' });
    }

    const gBody = {
      input: { text },
      audio: { encoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE }
    };

    try {
      const gResp = await fetch(GEMINI_TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GEMINI_API_KEY}` },
        body: JSON.stringify(gBody)
      });

      if (!gResp.ok) {
        const txt = await gResp.text().catch(() => '<no body>');
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
