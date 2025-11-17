// Spotify Web Playback demo script
// Note: this demo uses a small server-side token exchange. See README.md

let REDIRECT_URI = null; // provided by server /config (uses explicit loopback by default)

const btnConnect = document.getElementById('btn-connect');
const authStatus = document.getElementById('auth-status');
const playerSection = document.getElementById('player');
const deviceIdEl = document.getElementById('device-id');
const trackInfoEl = document.getElementById('track-info');
const btnPlay = document.getElementById('btn-play');
const btnPause = document.getElementById('btn-pause');

let accessToken = null;
let spotifyPlayer = null;
let deviceId = null;
let progressTimer = null;
let lastState = null;
// Background toggle state and controls
const bgEl = document.getElementById('bg-blur');

// Scopes needed for playback control and reading playback state
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-top-read',
  'user-modify-playback-state',
  'user-read-currently-playing'
].join(' ');


function updateAuthStatus(msg) {
  authStatus.textContent = msg;
}

// startAuth will be wired after loading server config
function startAuth(authorize_url) {
  if (!authorize_url) return updateAuthStatus('No authorize URL available');
  if (!REDIRECT_URI) return updateAuthStatus('Redirect URI not configured on server');
  const url = new URL(authorize_url);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('show_dialog', 'true');
  window.location.href = url.toString();
}

async function loadConfig() {
  try {
    const r = await fetch('/config');
    const cfg = await r.json();
    if (cfg.redirect_uri) REDIRECT_URI = cfg.redirect_uri;
    // Wire the Connect button to the server-side /login endpoint
    btnConnect.addEventListener('click', () => {
      // open /login which redirects to Spotify with client_id included
      window.location.href = '/login';
    });
    updateAuthStatus('Configured redirect URI: ' + (REDIRECT_URI || 'not set'));
  } catch (err) {
    updateAuthStatus('Failed to load config: ' + err.message);
  }
}

// On load, check if we were redirected back with a code
async function handleRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return;
  updateAuthStatus('Exchanging code for token...');

  try {
    const resp = await fetch('/api/exchange_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: REDIRECT_URI })
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    accessToken = data.access_token;
    updateAuthStatus('Authenticated — token acquired. Initializing player...');
    window.history.replaceState({}, document.title, REDIRECT_URI);
    initPlayer();
    // fetch top tracks for default range once authenticated
    try { fetchTopTracks(document.getElementById('top-range')?.value || 'short_term'); } catch(e) { /* ignore */ }
  } catch (err) {
    updateAuthStatus('Token exchange failed: ' + err.message);
  }
}

// SDK Ready handler - set before script loads
window.onSpotifyWebPlaybackSDKReady = () => {
  console.log('%c === SPOTIFY SDK READY === ', 'background: #1DB954; color: white; font-size: 20px; font-weight: bold; padding: 5px;');
  if (accessToken) {
    console.log('Token present - initializing player');
    initPlayerImplementation();
  } else {
    console.log('No token yet - will initialize when token arrives');
  }
};

function initPlayer() {
  if (!accessToken) {
    updateAuthStatus('No access token — please authenticate first');
    return;
  }

  console.log('Initializing player with access token');
  updateAuthStatus('Initializing Spotify player...');

  if (window.Spotify) {
    initPlayerImplementation();
  } else {
    updateAuthStatus('Waiting for Spotify SDK to load...');
  }
}

function initPlayerImplementation() {
  // Add timeout to detect initialization issues
  const initTimeout = setTimeout(() => {
    console.error('Player initialization timed out after 15s');
    updateAuthStatus('Player initialization timed out. Checking Spotify status...');
    
    // Check if we can access user profile to verify Premium status
    fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    })
    .then(r => r.json())
    .then(data => {
      console.log('User profile:', data);
      if (data.product !== 'premium') {
        updateAuthStatus('Your account type is: ' + data.product + '. Premium is required for playback.');
      } else {
        updateAuthStatus('Account is Premium. Please try refreshing the page and ensure Spotify is not playing elsewhere.');
      }
    })
    .catch(err => {
      console.error('Profile check failed:', err);
      updateAuthStatus('Could not verify account status. Token may have expired.');
    });
  }, 15000);

  console.log('Creating Spotify Player instance...');
  spotifyPlayer = new Spotify.Player({
    name: 'Web Playback SDK Demo Player',
    getOAuthToken: cb => { cb(accessToken); },
    volume: 0.5
  });

  // More descriptive error handling
  spotifyPlayer.addListener('initialization_error', ({ message }) => { 
    clearTimeout(initTimeout);
    updateAuthStatus('SDK Init error (check Premium status): ' + message); 
  });
  
  spotifyPlayer.addListener('authentication_error', ({ message }) => { 
    updateAuthStatus('Auth error (token may have expired): ' + message); 
  });
  
  spotifyPlayer.addListener('account_error', ({ message }) => { 
    updateAuthStatus('Account error (Premium required): ' + message); 
  });
  
  spotifyPlayer.addListener('playback_error', ({ message }) => { 
    updateAuthStatus('Playback error: ' + message); 
  });

  spotifyPlayer.addListener('not_ready', ({ device_id }) => {
    updateAuthStatus('Device not ready. Retrying connection...');
  });

  spotifyPlayer.addListener('player_state_changed', state => {
    if (!state) return;
    const current = state.track_window.current_track;
    trackInfoEl.textContent = current ? `${current.name} — ${current.artists.map(a=>a.name).join(', ')}` : 'No track playing';
    try {
      if (current) {
        // update mini-player
        if (miniCoverEl) {
          const img = current.album?.images?.[1]?.url || current.album?.images?.[0]?.url || '';
          miniCoverEl.src = img;
          miniCoverEl.style.display = img ? 'inline-block' : 'none';
          // set blurred background image behind main content
          try {
            const bg = document.getElementById('bg-blur');
            if (bg) {
              if (img) { bg.style.backgroundImage = `url('${img}')`; bg.style.opacity = '1'; }
              else { bg.style.backgroundImage = 'none'; bg.style.opacity = '0'; }
            }
          } catch(e) { /* ignore bg errors */ }
        }
        if (miniTitleEl) miniTitleEl.textContent = current.name || '-';
        if (miniArtistEl) miniArtistEl.textContent = current.artists.map(a=>a.name).join(', ');
      }
      // play/pause state
      if (miniPlayBtn && miniPauseBtn) {
        if (state.paused) { miniPlayBtn.style.display = 'inline-block'; miniPauseBtn.style.display = 'none'; }
        else { miniPlayBtn.style.display = 'none'; miniPauseBtn.style.display = 'inline-block'; }
      }
      // persist last played info (uri, track name, artists, album image, position)
      try {
        const lp = {
          uri: current.uri,
          name: current.name,
          artists: current.artists.map(a=>a.name),
          albumImage: current.album?.images?.[1]?.url || current.album?.images?.[0]?.url || '',
          position_ms: state.position || 0,
          duration_ms: state.duration || (current.duration_ms || 0),
          timestamp: Date.now()
        };
        localStorage.setItem('last_played', JSON.stringify(lp));
      } catch(e) { console.warn('persist last_played failed', e); }
      // update progress UI
      updateProgress(state.position || 0, state.duration || (current.duration_ms || 0));
      // start interval to tick progress while playing
      if (progressTimer) clearInterval(progressTimer);
      if (!state.paused) {
        progressTimer = setInterval(() => {
          // increment last known position
          lastState = lastState || state;
          lastState.position = (lastState.position || 0) + 1000;
          updateProgress(lastState.position, state.duration || (current.duration_ms || 0));
        }, 1000);
      }
    } catch (e) { console.warn('mini-player update failed', e); }
  });

  spotifyPlayer.addListener('ready', async ({ device_id }) => {
    clearTimeout(initTimeout);
    deviceId = device_id;
    deviceIdEl.textContent = deviceId;
    playerSection.classList.remove('hidden');
    updateAuthStatus('Player connected, activating device...');

    // Force transfer playback to our device and ensure it's active
    fetch('https://api.spotify.com/v1/me/player', {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        device_ids: [deviceId],
        play: false
      })
    }).then(() => {
      console.log('Transferred playback to device');
      // Double check our device is active
      return fetch('https://api.spotify.com/v1/me/player', {
        headers: { 'Authorization': 'Bearer ' + accessToken }
      });
    })
    .then(async response => {
      if (!response.ok) {
        throw new Error(`Transfer check status: ${response.status}`);
      }
      // Handle 204 No Content or empty response
      const text = await response.text();
      if (!text) {
        console.log('Empty response from player state check (might be normal)');
        return null;
      }
      try {
        return JSON.parse(text);
      } catch (e) {
        console.warn('Failed to parse player state response:', text);
        throw e;
      }
    })
    .then(data => {
      if (!data) {
        console.log('No player state data (normal for new session)');
        updateAuthStatus('Player ready. Click Play to start playback.');
        return;
      }
      console.log('Player state:', data);
      if (data.device?.id === deviceId) {
        updateAuthStatus('Player ready and active.');
      } else {
        // Device not active, try to activate it
        return fetch('https://api.spotify.com/v1/me/player', {
          method: 'PUT',
          headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_ids: [deviceId], play: false })
        }).then(() => {
          updateAuthStatus('Player activated and ready.');
        });
      }
    })
    .catch(err => {
      console.warn('Transfer check failed:', err);
      updateAuthStatus('Player ready. Click Play to start playback.');
    });

    // After device ready, if we have a last-played saved try to resume automatically
    try {
      const resumed = await attemptResumeLast();
      const resumeBtn = document.getElementById('btn-resume');
      if (!resumed && resumeBtn) {
        resumeBtn.classList.remove('hidden');
        resumeBtn.addEventListener('click', async () => {
          await attemptResumeLast();
          resumeBtn.classList.add('hidden');
        }, { once: true });
      } else if (resumed && resumeBtn) {
        resumeBtn.classList.add('hidden');
      }
    } catch(e) { console.warn('resume flow failed', e); }
  });

  // Connect and handle errors
  console.log('Attempting to connect to Spotify...');
  spotifyPlayer.connect().then(success => {
    console.log('Connect result:', success);
    if (!success) {
      clearTimeout(initTimeout);
      updateAuthStatus('Failed to connect to Spotify. Please check if you have a Premium account.');
    }
  }).catch(err => {
    console.error('Connect error:', err);
    clearTimeout(initTimeout);
    updateAuthStatus('Connection error: ' + (err.message || 'Unknown error'));
  });
}

btnPlay.addEventListener('click', async () => {
  if (!accessToken || !deviceId) { updateAuthStatus('Authenticate and wait for player ready'); return; }
  updateAuthStatus('Preparing playback...');
  
  try {
    // First ensure our device is the active device
    await fetch('https://api.spotify.com/v1/me/player', {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_ids: [deviceId], play: false })
    });
    
    // Then start playback
    const sampleTrack = 'spotify:track:3n3Ppam7vgaVa1iaRUc9Lp';
    updateAuthStatus('Starting playback...');
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [sampleTrack] })
    });
    updateAuthStatus('Playback started');
  } catch (err) {
    updateAuthStatus('Play failed: ' + err.message);
  }
});

btnPause.addEventListener('click', async () => {
  if (!accessToken || !deviceId) { updateAuthStatus('Authenticate and wait for player ready'); return; }
  try {
    await fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    updateAuthStatus('Paused');
  } catch (err) {
    updateAuthStatus('Pause failed: ' + err.message);
  }
});

// --- Top tracks helpers and UI wiring ---
// use let and defensive lookups in case DOM changed during edits
let topRangeEl = document.getElementById('top-range');
let btnRefreshTop = document.getElementById('btn-refresh-top');
let btnPlayTop = document.getElementById('btn-play-top');
let topListEl = document.getElementById('top-list');
let topDebugEl = document.getElementById('top-debug');

// Fallbacks: try querySelector if initial lookups failed
if (!topRangeEl) topRangeEl = document.querySelector('#top-range');
if (!btnRefreshTop) btnRefreshTop = document.querySelector('#btn-refresh-top');
if (!btnPlayTop) btnPlayTop = document.querySelector('#btn-play-top');
if (!topListEl) topListEl = document.querySelector('#top-list');
if (!topDebugEl) topDebugEl = document.querySelector('#top-debug');

console.debug('Top tracks elements:', { topRangeEl, btnRefreshTop, btnPlayTop, topListEl });
const miniCoverEl = document.getElementById('mini-cover');
const miniTitleEl = document.getElementById('mini-title');
const miniArtistEl = document.getElementById('mini-artist');
const miniPlayBtn = document.getElementById('mini-play');
const miniPauseBtn = document.getElementById('mini-pause');
const miniNextBtn = document.getElementById('mini-next');
const miniPrevBtn = document.getElementById('mini-prev');

// persist selected time-range
try {
  const saved = localStorage.getItem('top_range');
  if (saved && topRangeEl) topRangeEl.value = saved;
} catch (e) { /* ignore storage errors */ }

if (topRangeEl) topRangeEl.addEventListener('change', () => {
  try { localStorage.setItem('top_range', topRangeEl.value); } catch(e) {}
  fetchTopTracks(topRangeEl.value);
});

async function fetchTopTracks(time_range = 'short_term') {
  if (!accessToken) {
    updateAuthStatus('Authenticate to load top tracks');
    return [];
  }
  updateAuthStatus('Loading top tracks...');
  if (topDebugEl) topDebugEl.textContent = 'Status: loading...';
  try {
    const url = `https://api.spotify.com/v1/me/top/tracks?limit=5&time_range=${time_range}`;
    console.log('fetchTopTracks ->', url);
    const resp = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(()=>'<no body>');
      throw new Error(`Failed to fetch top tracks: ${resp.status} ${errText}`);
    }
    const data = await resp.json();
    const items = data.items || [];
    console.debug('Top tracks response items:', items);
    renderTopTracks(items);
    updateAuthStatus(items.length ? 'Top tracks loaded' : 'No top tracks found');
    if (topDebugEl) {
      const names = items.map(t=>t.name).slice(0,10).join(' • ');
      topDebugEl.textContent = `Status: ${items.length} items loaded${items.length? ': ' + names : ''}`;
    }
    return items;
  } catch (err) {
    console.error('Top tracks error', err);
    updateAuthStatus('Failed to load top tracks: ' + (err.message || err));
    if (topListEl) topListEl.innerHTML = '<li class="muted">Failed to load top tracks.</li>';
    if (topDebugEl) topDebugEl.textContent = 'Status: fetch failed';
    return [];
  }
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2,'0')}`;
}

function renderTopTracks(tracks) {
  if (!topListEl) {
    console.warn('renderTopTracks: #top-list element not found');
    return;
  }
  topListEl.innerHTML = '';
  if (!tracks || tracks.length === 0) {
    topListEl.innerHTML = '<li class="muted">No top tracks available.</li>';
    return;
  }
  tracks.forEach((t, i) => {
    const li = document.createElement('li');
    // ensure visibility regardless of CSS overrides
    li.style.display = 'flex';
    li.style.alignItems = 'center';
    li.style.gap = '12px';
    // thumbnail
    const img = document.createElement('img');
    img.className = 'track-thumb';
    img.src = t.album?.images?.[2]?.url || t.album?.images?.[0]?.url || '';
    img.alt = t.name;
    img.style.display = img.src ? 'block' : 'none';
    // meta
    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = t.name;
  const sub = document.createElement('div');
  sub.className = 'sub';
  const artistNames = (t.artists && t.artists.length) ? t.artists.map(a=>a.name).join(', ') : 'Unknown artist';
  sub.textContent = `${artistNames} • ${formatDuration(t.duration_ms)}`;
    meta.appendChild(title);
    meta.appendChild(sub);

    li.appendChild(img);
    li.appendChild(meta);
    li.dataset.uri = t.uri;
    li.dataset.index = i;
    li.addEventListener('click', () => {
      // optimistic mini-player update so user sees cover/title/artist immediately
      try {
        const imgUrl = t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || '';
        if (miniCoverEl) { miniCoverEl.src = imgUrl; miniCoverEl.style.display = imgUrl ? 'inline-block' : 'none'; }
        if (miniTitleEl) miniTitleEl.textContent = t.name || '-';
        if (miniArtistEl) miniArtistEl.textContent = artistNames || 'Unknown artist';
      } catch(e) { console.warn('optimistic mini update failed', e); }
      playTrackUri(t.uri);
    });
    topListEl.appendChild(li);
  });
}

async function ensureDeviceActive() {
  if (!deviceId) throw new Error('Player device not ready');
  // Try to transfer playback to our device without starting playback
  await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_ids: [deviceId], play: false })
  });
  // small delay to let Spotify register the active device
  await new Promise(r => setTimeout(r, 400));
}

async function playTrackUri(uri) {
  if (!accessToken) return updateAuthStatus('Authenticate first');
  if (!deviceId) return updateAuthStatus('Player not ready — wait for device to show');
  try {
    await ensureDeviceActive();
    updateAuthStatus('Starting track...');
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] })
    });
    updateAuthStatus('Playback started');
    // persist last-played minimal info immediately
    try {
      const meta = { uri, position_ms: 0, timestamp: Date.now() };
      localStorage.setItem('last_played', JSON.stringify(meta));
    } catch(e) {}
  } catch (err) {
    console.error('Play track error', err);
    updateAuthStatus('Failed to start playback: ' + (err.message || err));
  }
}

function updateProgress(position_ms, duration_ms) {
  const curEl = document.getElementById('progress-current');
  const durEl = document.getElementById('progress-duration');
  const fill = document.getElementById('progress-fill');
  if (curEl) curEl.textContent = formatDuration(position_ms || 0);
  if (durEl) durEl.textContent = formatDuration(duration_ms || 0);
  if (fill && duration_ms > 0) {
    const pct = Math.min(100, Math.max(0, (position_ms / duration_ms) * 100));
    fill.style.width = pct + '%';
  }
}

async function attemptResumeLast() {
  try {
    const raw = localStorage.getItem('last_played');
    if (!raw) return false;
    const lp = JSON.parse(raw);
    if (!lp.uri) return false;
    
    // check player state and our device
    const response = await fetch('https://api.spotify.com/v1/me/player', { 
      headers: { 'Authorization': 'Bearer ' + accessToken } 
    });
    
    // Handle response carefully
    let cur = null;
    if (response.status === 204) {
      console.log('No active player state (normal for new session)');
    } else if (!response.ok) {
      throw new Error(`Player state check failed: ${response.status}`);
    } else {
      const text = await response.text();
      try {
        cur = text ? JSON.parse(text) : null;
      } catch (e) {
        console.warn('Failed to parse player state:', text);
        throw e;
      }
    }
    
    if (!deviceId) {
      console.warn('No device ID available');
      return false;
    }
    
    // Ensure our device is active
    if (!cur || cur.device?.id !== deviceId) {
      console.log('Activating our device before resuming...');
      await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_ids: [deviceId], play: false })
      });
      // small delay to let Spotify register the device
      await new Promise(r => setTimeout(r, 400));
    }
    
    // Start playback at the saved position
    const playResponse = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [lp.uri], position_ms: lp.position_ms || 0 })
    });
    
    if (!playResponse.ok) {
      throw new Error(`Resume playback failed: ${playResponse.status}`);
    }
    
    updateAuthStatus('Resumed last track');
    return true;
  } catch (e) {
    console.warn('resume failed', e);
    return false;
  }
}

// mini-player control helpers
async function apiPlay() {
  if (!accessToken) return;
  await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, { method: 'PUT', headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' } });
}
async function apiPause() {
  if (!accessToken) return;
  await fetch('https://api.spotify.com/v1/me/player/pause', { method: 'PUT', headers: { 'Authorization': 'Bearer ' + accessToken } });
}
async function apiNext() {
  if (!accessToken) return;
  await fetch('https://api.spotify.com/v1/me/player/next', { method: 'POST', headers: { 'Authorization': 'Bearer ' + accessToken } });
}
async function apiPrevious() {
  if (!accessToken) return;
  await fetch('https://api.spotify.com/v1/me/player/previous', { method: 'POST', headers: { 'Authorization': 'Bearer ' + accessToken } });
}

// wire mini-player buttons
if (miniPlayBtn) miniPlayBtn.addEventListener('click', async () => { try { await apiPlay(); } catch(e){console.warn(e)} });
if (miniPauseBtn) miniPauseBtn.addEventListener('click', async () => { try { await apiPause(); } catch(e){console.warn(e)} });
if (miniNextBtn) miniNextBtn.addEventListener('click', async () => { try { await apiNext(); } catch(e){console.warn(e)} });
if (miniPrevBtn) miniPrevBtn.addEventListener('click', async () => { try { await apiPrevious(); } catch(e){console.warn(e)} });

// Update mini-player when player state changes
const origPlayerStateHandler = spotifyPlayer && spotifyPlayer._handlers;
// We already listen to player_state_changed inside initPlayerImplementation; enhance that to update UI
// (we'll also set these when the event triggers)


// UI wiring
btnRefreshTop && btnRefreshTop.addEventListener('click', () => fetchTopTracks(topRangeEl.value || 'short_term'));
btnPlayTop && btnPlayTop.addEventListener('click', async () => {
  const tracks = await fetchTopTracks(topRangeEl.value || 'short_term');
  if (tracks && tracks[0]) playTrackUri(tracks[0].uri);
});

// Initialize background toggle, then load config (to get redirect_uri) and handle redirect code
loadConfig().then(() => handleRedirect());

/* --- Layout diagnostic tool (temporary) ---
(function setupLayoutDiagnostic(){
  try {
    const btn = document.createElement('button');
    btn.id = 'btn-run-diag';
    btn.textContent = 'Run layout diag';
    document.body.appendChild(btn);

    function scanAndMark(enable){
      const all = document.querySelectorAll('body *');
      const flagged = [];
      all.forEach(el => {
        const s = window.getComputedStyle(el);
        const reasons = [];
        if (s.transform && s.transform !== 'none') reasons.push('transform:'+s.transform.replace(/\s+/g,' '));
        if (s.position === 'absolute' || s.position === 'fixed' || s.position === 'sticky') reasons.push('position:'+s.position);
        const z = parseInt(s.zIndex,10);
        if (!Number.isNaN(z) && z !==  'auto' && z !== 0) reasons.push('z-index:'+s.zIndex);
        // also check for negative margins or large negative top/left
        if ((s.marginTop && s.marginTop.startsWith('-')) || (s.marginBottom && s.marginBottom.startsWith('-'))) reasons.push('negative-margin');
        if (reasons.length){
          flagged.push({el,reasons});
          if (enable){
            el.classList.add('layout-debug-outline');
            el.setAttribute('data-debug-reasons', reasons.join(';'));
          } else {
            el.classList.remove('layout-debug-outline');
            el.removeAttribute('data-debug-reasons');
          }
        }
      });
      console.group('Layout diagnostic results — flagged elements: '+flagged.length);
      flagged.forEach((f,i)=>{
        console.log(i+1, f.el, f.reasons.join(';'));
      });
      console.groupEnd();
      return flagged;
    }

    let diagOn = false;
    btn.addEventListener('click', () => {
      diagOn = !diagOn;
      btn.textContent = diagOn ? 'Clear layout diag' : 'Run layout diag';
      const flagged = scanAndMark(diagOn);
      if (diagOn && flagged.length){
        // scroll to first flagged element for convenience
        try { flagged[0].el.scrollIntoView({behavior:'smooth', block:'center'}); } catch(e){}
      }
    });
  } catch(e) { console.warn('layout diag setup failed', e) }
})(); */