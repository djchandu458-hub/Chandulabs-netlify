// netlify/functions/voice.js
// Simple Netlify function for ChanduLabs
// Accepts POST JSON: { text, language, mode }
// Returns audio/wav as base64 (isBase64Encoded: true)

const SAMPLE_RATE = 24000;

exports.handler = async function (event, context) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Only POST allowed' }) };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const text = (body.text || '').trim();
    const language = body.language || 'en';
    const mode = body.mode || 'cloned';

    if (!text) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing text' }) };
    }

    const RVC_SERVER_URL = (process.env.RVC_SERVER_URL || '').replace(/\/$/, '');
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
    const GEMINI_TTS_URL = process.env.GEMINI_TTS_URL || 'https://api.generativeai.googleapis.com/v1beta2/speech:generate';

    // If cloned mode and RVC server configured, proxy to it
    if (mode === 'cloned' && RVC_SERVER_URL) {
      try {
        const resp = await fetch(`${RVC_SERVER_URL}/synthesize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, language })
        });

        if (!resp.ok) {
          const txt = await resp.text();
          return { statusCode: 502, body: JSON.stringify({ error: 'RVC server failed', details: txt.slice(0,300) }) };
        }

        const ab = await resp.arrayBuffer();
        const buf = Buffer.from(ab);

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'audio/wav' },
          body: buf.toString('base64'),
          isBase64Encoded: true
        };
      } catch (err) {
        return { statusCode: 502, body: JSON.stringify({ error: 'RVC connection error', details: String(err).slice(0,300) }) };
      }
    }

    // Fallback to Gemini TTS
    if (!GEMINI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'No RVC_SERVER_URL or GEMINI_API_KEY configured' }) };
    }

    const gBody = {
      input: { text },
      audio: { encoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE }
    };

    const gResp = await fetch(GEMINI_TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GEMINI_API_KEY}` },
      body: JSON.stringify(gBody)
    });

    if (!gResp.ok) {
      const txt = await gResp.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Gemini TTS failed', details: txt.slice(0,300) }) };
    }

    const gab = await gResp.arrayBuffer();
    const gb = Buffer.from(gab);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'audio/wav' },
      body: gb.toString('base64'),
      isBase64Encoded: true
    };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal error', details: String(e).slice(0,300) }) };
  }
};
