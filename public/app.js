// public/app.js
// Enhanced controls: Send (prepare), Speak (prepare+play), Play, Stop
(() => {
  const $ = id => document.getElementById(id);
  const logEl = () => $('log');

  function log(msg) { if (logEl()) logEl().textContent = msg; console.log(msg); }

  const textEl = () => $('text');
  const langEl  = () => $('lang');
  const sendBtn = () => $('sendBtn');
  const speakBtn = () => $('speakBtn');
  const playBtn = () => $('playBtn');
  const stopBtn = () => $('stopBtn');
  const player = () => $('player');

  let lastBase64 = null;
  let lastBlobUrl = null;

  function base64ToBlob(base64, mime='audio/wav') {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function setPlayerFromBase64(b64) {
    if (!b64) return;
    try {
      const blob = base64ToBlob(b64, 'audio/wav');
      if (lastBlobUrl) { try { URL.revokeObjectURL(lastBlobUrl); } catch(e) {} }
      lastBlobUrl = URL.createObjectURL(blob);
      player().src = lastBlobUrl;
    } catch (e) {
      console.error('setPlayerFromBase64 error', e);
      throw e;
    }
  }

  async function callVoiceAPI(text, language) {
    const endpoint = '/.netlify/functions/voice';
    log('Sending to server...');
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language, mode: 'cloned' })
    });

    if (!resp.ok) {
      const body = await resp.text().catch(()=>'<no body>');
      throw new Error('Server error: ' + body);
    }

    const b64 = await resp.text();
    if (!b64) throw new Error('Empty response from server.');
    return b64.trim();
  }

  async function handleSend(autoplay=false) {
    const txt = (textEl().value || '').trim();
    const lang = (langEl().value || 'en');

    if (!txt) { alert('Type text to send.'); return; }

    // UI
    sendBtn().disabled = true;
    speakBtn().disabled = true;
    playBtn().disabled = true;
    stopBtn().disabled = false;
    log('Processing...');

    try {
      const b64 = await callVoiceAPI(txt, lang);
      lastBase64 = b64;
      setPlayerFromBase64(b64);
      log(autoplay ? 'Playing...' : 'Audio prepared. Press Play to listen.');
      if (autoplay) {
        try { await player().play(); } catch(e){ console.warn('auto play failed', e); }
      }
      playBtn().disabled = false;
    } catch (err) {
      console.error(err);
      alert('Error: ' + (err.message || err));
      log('Error: ' + (err.message || err));
    } finally {
      sendBtn().disabled = false;
      speakBtn().disabled = false;
    }
  }

  // play/stop handlers
  playBtn().addEventListener('click', () => {
    if (!lastBase64) { log('No audio prepared. Press Send or Speak first.'); return; }
    try { player().play(); log('Playing...'); } catch(e){ console.warn(e); }
  });

  stopBtn().addEventListener('click', () => {
    try { player().pause(); player().currentTime = 0; log('Stopped.'); } catch(e){ console.warn(e); }
  });

  // Send (prepare but don't autoplay)
  sendBtn().addEventListener('click', () => handleSend(false));

  // Speak (prepare and autoplay)
  speakBtn().addEventListener('click', () => handleSend(true));

  // initial state
  (function init(){
    playBtn().disabled = true;
    sendBtn().disabled = false;
    speakBtn().disabled = false;
    stopBtn().disabled = true;
    log('Ready.');
    // enable stop when audio exists
    player().addEventListener('play', ()=> stopBtn().disabled = false);
    player().addEventListener('pause', ()=> {});
    player().addEventListener('ended', ()=> log('Playback finished.'));
  })();

})();
