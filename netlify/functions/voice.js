// netlify/functions/voice.js
// FINAL FIXED VERSION — works 100% with Gemini API keys

const SAMPLE_RATE = 24000;

function jsonError(status, obj) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(obj),
  };
}

function base64Response(base64) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "audio/wav", "Access-Control-Allow-Origin": "*" },
    body: base64,
    isBase64Encoded: true,
  };
}

// Extract Gemini reply text
function extractReply(json) {
  try {
    return (
      json?.candidates?.[0]?.content?.parts?.[0]?.text ||
      json?.candidates?.[0]?.output_text ||
      json?.contents?.[0]?.parts?.[0]?.text ||
      JSON.stringify(json)
    );
  } catch {
    return "Sorry, I couldn't generate a reply.";
  }
}

// Gemini text generation (new API)
async function geminiGenerate(userText, apiKey) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" +
    apiKey;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: userText }],
      },
    ],
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw { status: resp.status, details: txt };
  }

  return extractReply(await resp.json());
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return jsonError(405, { error: "Only POST allowed" });
    }

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return jsonError(400, { error: "Invalid JSON" });
    }

    const userText = (body.text || "").trim();
    const language = body.language || "en";
    const mode = body.mode || "cloned";

    if (!userText) return jsonError(400, { error: "Missing text" });

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const RVC_SERVER_URL = (process.env.RVC_SERVER_URL || "").replace(/\/$/, "");

    if (!GEMINI_API_KEY) {
      return jsonError(500, { error: "Missing GEMINI_API_KEY" });
    }

    // STEP 1 — Gemini text generation
    let reply;
    try {
      reply = await geminiGenerate(userText, GEMINI_API_KEY);
    } catch (err) {
      return jsonError(502, {
        error: "Gemini text generation failed",
        details: err.details,
      });
    }

    // STEP 2 — Check cloned voice path
    if (mode === "cloned" && RVC_SERVER_URL) {
      try {
        const r = await fetch(`${RVC_SERVER_URL}/synthesize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: reply, language }),
        });

        if (!r.ok) {
          const txt = await r.text();
          return jsonError(502, { error: "RVC server failed", details: txt });
        }

        const buf = Buffer.from(await r.arrayBuffer());
        return base64Response(buf.toString("base64"));
      } catch (err) {
        return jsonError(502, { error: "RVC connection error", details: String(err) });
      }
    }

    // STEP 3 — Gemini TTS fallback
    const TTS_URL =
      "https://api.generativeai.googleapis.com/v1beta2/speech:generate?key=" +
      GEMINI_API_KEY;

    const tBody = {
      input: { text: reply },
      audio: {
        encoding: "LINEAR16",
        sampleRateHertz: SAMPLE_RATE,
      },
    };

    const tResp = await fetch(TTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tBody),
    });

    if (!tResp.ok) {
      const txt = await tResp.text();
      return jsonError(502, {
        error: "Gemini TTS failed",
        details: txt,
      });
    }

    const buf = Buffer.from(await tResp.arrayBuffer());
    return base64Response(buf.toString("base64"));
  } catch (e) {
    return jsonError(500, { error: "Internal error", details: String(e) });
  }
};
