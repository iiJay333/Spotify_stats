# Spotify Web Playback Demo (local)

This is a small demo that shows how to authenticate with Spotify (Authorization Code flow) and use the Spotify Web Playback SDK to play music through your own Spotify account (requires Spotify Premium).

Files added/changed:
- `index.html` — demo UI
- `script.js` — client-side logic (auth redirect handling, SDK init, play/pause)
- `style.css` — basic styling
- `server.js` — small Express server used to exchange the authorization code for tokens
- `package.json` — dependencies and start script

Quick start
1. Create a Spotify Developer App at https://developer.spotify.com/dashboard/
   - Add a Redirect URI: use the explicit loopback address, for example:
     `http://127.0.0.1:3000/` (do not use the string "localhost" — Spotify now requires an explicit loopback address for HTTP redirects).
   - Copy the Client ID and Client Secret.

2. In this project directory create a `.env` file with (recommended):

```
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
PORT=3000
# Optional: explicitly set redirect to loopback IP to match Spotify's requirements
REDIRECT_URI=http://127.0.0.1:3000/
```

3. Install dependencies and start the server (you need Node.js installed):

```powershell
npm install
npm start
```

4. Open the site using the loopback IP in your browser and click "Connect with Spotify":

```
http://127.0.0.1:3000/
```

Log in and allow permissions. The page will initialize the Web Playback SDK and you can press "Play sample track" to start playback on the new device created by the SDK.

Important: Spotify requires redirect URIs to be HTTPS or an explicit loopback address (127.0.0.1 or [::1]). Make sure the Redirect URI you register in the Dashboard exactly matches the one you use in your browser (including the trailing slash).

Notes and caveats
- Playback requires a Spotify Premium account.
- This demo uses a server to exchange the authorization code for tokens. That means you must keep the client secret secure and run this server locally or on a trusted host.
- Access tokens expire (typically after 1 hour). This demo does not implement token refresh; for a production app implement refresh using the refresh token returned by Spotify.

