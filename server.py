"""
Zyra Backend — Flask server with:
  • JioSaavn music search + streaming
  • JWT Email/Password authentication
  • Per-user PostgreSQL data (favorites, playlists, history, downloads)
  • Smart mood-based autoplay recommendations
"""

from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import requests as http_requests
import random, time, os, re, html, jwt, hashlib, uuid
from base64 import b64decode
from datetime import datetime, timedelta
import pg8000.dbapi
from urllib.parse import urlparse
from recommender import (
    detect_mood, get_query_for_mood, get_time_of_day_mood,
    build_recommendation_reason, MOOD_LABELS
)

app = Flask(__name__)
CORS(app)

# ─── Config ───────────────────────────────────────────────────────────────────

DATABASE_URL    = os.environ.get('DATABASE_URL', '')
JWT_SECRET      = os.environ.get('JWT_SECRET', 'zyra-super-secret-2025')
JWT_EXPIRY_DAYS = 30

# ─── PostgreSQL ───────────────────────────────────────────────────────────────

def get_db():
    import ssl
    parsed  = urlparse(DATABASE_URL)
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode    = ssl.CERT_NONE
    return pg8000.dbapi.connect(
        host=parsed.hostname,
        database=parsed.path.lstrip('/'),
        user=parsed.username,
        password=parsed.password,
        port=parsed.port or 5432,
        ssl_context=ssl_ctx,
        timeout=10
    )

def _row_to_dict(description, row):
    if row is None or description is None:
        return None
    return {desc[0]: row[i] for i, desc in enumerate(description)}

def _rows_to_dicts(description, rows):
    if not description or not rows:
        return []
    cols = [d[0] for d in description]
    return [dict(zip(cols, row)) for row in rows]

def _to_list(val):
    if val is None: return []
    if isinstance(val, list): return val
    if isinstance(val, str):
        try: return _json.loads(val)
        except: return []
    return []

def _to_dict_safe(val):
    if val is None: return {}
    if isinstance(val, dict): return val
    if isinstance(val, str):
        try: return _json.loads(val)
        except: return {}
    return {}

def init_db():
    if not DATABASE_URL:
        print('WARNING: DATABASE_URL not set — skipping DB init')
        return
    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id            TEXT PRIMARY KEY,
                email         TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                username      TEXT,
                created_at    TIMESTAMP DEFAULT NOW(),
                favorites     JSONB DEFAULT '[]'::jsonb,
                playlists     JSONB DEFAULT '[]'::jsonb,
                history       JSONB DEFAULT '[]'::jsonb,
                downloads     JSONB DEFAULT '[]'::jsonb,
                settings      JSONB DEFAULT '{"shake_enabled":false,"smart_autoplay":true}'::jsonb
            )
        """)
        conn.commit()
        cur.close(); conn.close()
        print('PostgreSQL DB initialized OK')
    except Exception as e:
        print(f'DB init error: {e}')

init_db()

# ─── In-memory cache ──────────────────────────────────────────────────────────

SEARCH_CACHE_TTL  = 300
URL_CACHE_TTL     = 780
YT_URL_CACHE_TTL  = 300   # YouTube URLs expire after ~6h; we refresh after 5 min to be safe
search_cache  = {}
url_cache     = {}
yt_url_cache  = {}         # keyed by "title|artist"

def get_cached_search(query):
    item = search_cache.get(query)
    if item and time.time() - item['ts'] < SEARCH_CACHE_TTL:
        return item['results']
    search_cache.pop(query, None)
    return None

def set_cached_search(query, results):
    search_cache[query] = {'ts': time.time(), 'results': results}

def get_cached_url(track_id):
    item = url_cache.get(track_id)
    if item and time.time() - item['ts'] < URL_CACHE_TTL:
        return item['url']
    url_cache.pop(track_id, None)
    return None

def set_cached_url(track_id, url):
    url_cache[track_id] = {'ts': time.time(), 'url': url}

def get_cached_yt_url(key):
    item = yt_url_cache.get(key)
    if item and time.time() - item['ts'] < YT_URL_CACHE_TTL:
        return item['url']
    yt_url_cache.pop(key, None)
    return None

def set_cached_yt_url(key, url):
    yt_url_cache[key] = {'ts': time.time(), 'url': url}

# ─── DB Helpers ───────────────────────────────────────────────────────────────

def db_get_user_by_email(email):
    conn = get_db(); cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE email = %s", (email,))
    row = cur.fetchone()
    result = _row_to_dict(cur.description, row)
    cur.close(); conn.close()
    if result:
        result['favorites'] = _to_list(result.get('favorites'))
        result['playlists'] = _to_list(result.get('playlists'))
        result['history']   = _to_list(result.get('history'))
        result['downloads'] = _to_list(result.get('downloads'))
        result['settings']  = _to_dict_safe(result.get('settings'))
    return result

def db_get_user_by_id(user_id):
    conn = get_db(); cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
    row = cur.fetchone()
    result = _row_to_dict(cur.description, row)
    cur.close(); conn.close()
    if result:
        result['favorites'] = _to_list(result.get('favorites'))
        result['playlists'] = _to_list(result.get('playlists'))
        result['history']   = _to_list(result.get('history'))
        result['downloads'] = _to_list(result.get('downloads'))
        result['settings']  = _to_dict_safe(result.get('settings'))
    return result

def db_update_user(user_id, **fields):
    if not fields:
        return
    sets   = ', '.join(f"{k} = %s" for k in fields)
    values = list(fields.values()) + [user_id]
    conn   = get_db(); cur = conn.cursor()
    cur.execute(f"UPDATE users SET {sets} WHERE id = %s", values)
    conn.commit(); cur.close(); conn.close()

# ─── Password Hashing ─────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = os.urandom(32)
    key  = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
    return (salt + key).hex()

def verify_password(stored_hex: str, provided: str) -> bool:
    try:
        stored     = bytes.fromhex(stored_hex)
        salt       = stored[:32]
        stored_key = stored[32:]
        key = hashlib.pbkdf2_hmac('sha256', provided.encode('utf-8'), salt, 100000)
        return key == stored_key
    except Exception:
        return False

# ─── JWT Helpers ──────────────────────────────────────────────────────────────

def create_token(user_id: str) -> str:
    payload = {
        'sub': user_id,
        'exp': datetime.utcnow() + timedelta(days=JWT_EXPIRY_DAYS),
        'iat': datetime.utcnow(),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')

def verify_token(token: str):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        return payload['sub']
    except Exception:
        return None

def get_user_from_request():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return None
    user_id = verify_token(auth[7:])
    if not user_id:
        return None
    return db_get_user_by_id(user_id)

def user_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        user = get_user_from_request()
        if not user:
            return jsonify({'success': False, 'error': 'Unauthorized'}), 401
        return f(user, *args, **kwargs)
    return decorated

# ─── JioSaavn Helpers ─────────────────────────────────────────────────────────

JIOSAAVN_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Accept': 'application/json',
}

def clean_html(text: str) -> str:
    text = html.unescape(text)
    text = re.sub(r'<[^>]+>', '', text)
    return text.strip()

def decrypt_jiosaavn_url(encrypted_url: str) -> str:
    try:
        from Crypto.Cipher import DES
        key = b'38346591'
        enc = b64decode(encrypted_url.strip())
        cipher = DES.new(key, DES.MODE_ECB)
        decrypted = cipher.decrypt(enc)
        pad_len = decrypted[-1]
        if isinstance(pad_len, int) and 1 <= pad_len <= 8:
            decrypted = decrypted[:-pad_len]
        url = decrypted.decode('utf-8', errors='ignore').strip()
        url = url.replace('_96.mp4', '_320.mp4').replace('_160.mp4', '_320.mp4')
        return url
    except Exception as e:
        print(f'DES decryption error: {e}')
        return ''

def upgrade_image_url(url: str) -> str:
    """Replace any WxH size pattern in a JioSaavn image URL with 500x500."""
    if not url:
        return url
    # Handles: 50x50, 150x150, 100x100, 175x175, etc.
    return re.sub(r'\d+x\d+', '500x500', url)

def jiosaavn_search(query: str):
    """Search JioSaavn. Uses search.getResults (proper API) with autocomplete fallback."""
    # ── Primary: proper full-text search API ──
    try:
        resp = http_requests.get(
            'https://www.jiosaavn.com/api.php',
            params={
                '__call': 'search.getResults',
                'p': '1',
                'q': query,
                'n': '20',
                '_format': 'json',
                '_marker': '0',
                'ctx': 'android',
            },
            headers=JIOSAAVN_HEADERS, timeout=8
        )
        data = resp.json()
        songs_raw = data.get('results', [])
        results = []
        for song in songs_raw[:15]:
            song_id = song.get('id', '')
            if not song_id:
                continue
            # NOTE: search.getResults uses 'song' not 'title' as the field name
            title  = clean_html(
                song.get('song', '') or
                song.get('title', '') or 'Unknown'
            )
            mi     = song.get('more_info', {})
            artist = clean_html(
                mi.get('singers', '') or
                mi.get('primary_artists', '') or
                song.get('primary_artists', '') or
                song.get('description', '') or 'Unknown'
            )
            image  = upgrade_image_url(song.get('image', ''))
            if title and title != 'Unknown':
                results.append({'id': song_id, 'title': title, 'artist': artist, 'image': image, 'url': None, 'source': 'jiosaavn'})
        if results:
            return results
    except Exception as e:
        print(f'JioSaavn search.getResults error: {e}')

    # ── Fallback: autocomplete API ──
    try:
        resp = http_requests.get(
            'https://www.jiosaavn.com/api.php',
            params={'__call': 'autocomplete.get', 'query': query,
                    '_format': 'json', '_marker': '0', 'ctx': 'android'},
            headers=JIOSAAVN_HEADERS, timeout=8
        )
        data = resp.json()
        songs_raw = data.get('songs', {}).get('data', [])
        results = []
        for song in songs_raw[:10]:
            song_id = song.get('id', '')
            title   = clean_html(song.get('title', '') or song.get('song', '') or 'Unknown')
            artist  = clean_html(song.get('more_info', {}).get('singers', '') or song.get('description', '') or 'Unknown')
            image   = upgrade_image_url(song.get('image', ''))
            results.append({'id': song_id, 'title': title, 'artist': artist, 'image': image, 'url': None, 'source': 'jiosaavn'})
        return results
    except Exception as e:
        print(f'JioSaavn autocomplete fallback error: {e}')
        return []


def youtube_search_songs(query: str, max_results: int = 15):
    """Search YouTube Music for songs — returns exact Bollywood matches with clean metadata."""
    import re as _re
    try:
        import yt_dlp
        # Search YouTube Music specifically for much better song matching
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'noplaylist': True,
            'extract_flat': True,
            'default_search': f'https://music.youtube.com/search?q=',
            'socket_timeout': 20,
        }
        # Try YouTube Music search first, fall back to regular YouTube
        search_queries = [
            f'https://music.youtube.com/search?q={query}',  # YT Music
            f'ytsearch{max_results}:{query}',                # Regular YT fallback
        ]
        entries = []
        for sq in search_queries:
            try:
                flat_opts = {
                    'quiet': True, 'no_warnings': True, 'noplaylist': True,
                    'extract_flat': True, 'socket_timeout': 20,
                }
                with yt_dlp.YoutubeDL(flat_opts) as ydl:
                    info = ydl.extract_info(sq if 'ytsearch' in sq else f'ytsearch{max_results}:{query}', download=False)
                    entries = (info.get('entries', []) or []) if info else []
                    if entries:
                        break
            except Exception:
                continue

        results = []
        seen_titles = set()
        for entry in entries:
            if not entry:
                continue
            yt_id    = entry.get('id', '')
            if not yt_id:
                continue
            title    = entry.get('title', '') or ''
            channel  = entry.get('channel', '') or entry.get('uploader', '') or ''
            duration = entry.get('duration', 0) or 0

            # Skip very long videos (> 10 min) or very short (< 30s)
            if duration > 600 or (duration > 0 and duration < 30):
                continue

            # Skip non-music content
            title_lower = title.lower()
            skip_kw = ['podcast', 'interview', 'review', 'trailer', 'teaser', 'episode',
                       'vlog', 'gameplay', 'reaction', 'tutorial', 'news', 'comedy']
            if any(kw in title_lower for kw in skip_kw):
                continue

            # Clean title — strip (Official Video), [HD], | T-Series etc.
            clean_title = _re.sub(
                r'\s*[\(\[].*?(?:official|video|audio|lyric|hd|4k|full|song|music|ft\.|feat\.)[^\)\]]*[\)\]]\s*',
                '', title, flags=_re.IGNORECASE
            ).strip()
            clean_title = _re.sub(r'\s*\|.*$', '', clean_title).strip()  # remove " | T-Series" suffix
            clean_title = clean_title or title

            # Clean artist name — remove "- Topic" suffix from YouTube Music auto-generated channels
            clean_artist = _re.sub(r'\s*-\s*Topic$', '', channel, flags=_re.IGNORECASE).strip()
            clean_artist = clean_artist or channel

            # Deduplicate by title
            title_key = clean_title.lower().strip()
            if title_key in seen_titles:
                continue
            seen_titles.add(title_key)

            thumb = f'https://i.ytimg.com/vi/{yt_id}/hqdefault.jpg'
            results.append({
                'id':     f'yt_{yt_id}',
                'title':  clean_title,
                'artist': clean_artist,
                'image':  thumb,
                'url':    None,
                'source': 'youtube',
                'yt_id':  yt_id,
            })
            if len(results) >= max_results:
                break
        return results
    except Exception as e:
        print(f'YouTube search error: {e}')
        return []


def jiosaavn_get_audio_url(song_id: str) -> str:
    cached = get_cached_url(song_id)
    if cached:
        return cached
    try:
        resp = http_requests.get(
            'https://www.jiosaavn.com/api.php',
            params={'__call': 'song.getDetails', 'cc': 'in', '_bit_rate': '320',
                    '_format': 'json', 'pids': song_id, 'ctx': 'android', '_marker': '0'},
            headers=JIOSAAVN_HEADERS, timeout=10
        )
        data = resp.json()
        song_data = data.get(song_id, {})
        encrypted = song_data.get('encrypted_media_url', '')
        if not encrypted:
            direct = song_data.get('media_url', '')
            if direct:
                set_cached_url(song_id, direct)
                return direct
            return ''
        audio_url = decrypt_jiosaavn_url(encrypted)
        if audio_url:
            set_cached_url(song_id, audio_url)
        return audio_url
    except Exception as e:
        print(f'JioSaavn URL fetch error: {e}')
        return ''

# ─── YouTube Fallback ────────────────────────────────────────────────────────

def youtube_get_audio_url(title: str, artist: str) -> str:
    """Search YouTube for 'title artist' and return a direct audio stream URL.
    Uses yt-dlp in extract-only mode (no download). Returns '' on failure."""
    key = f"{title.lower().strip()}|{artist.lower().strip()}"
    cached = get_cached_yt_url(key)
    if cached:
        return cached
    try:
        import yt_dlp
        search_query = f"{title} {artist} official audio"
        ydl_opts = {
            'format': 'bestaudio/best',
            'quiet': True,
            'no_warnings': True,
            'noplaylist': True,
            'extract_flat': False,
            'skip_download': True,
            # Search YouTube and pick the first result
            'default_search': 'ytsearch1',
            'socket_timeout': 15,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(search_query, download=False)
            # ytsearch returns a playlist-like dict with entries
            if info and 'entries' in info:
                info = info['entries'][0]
            if not info:
                return ''
            # Pick the best audio-only format URL
            formats = info.get('formats', [])
            audio_url = ''
            # Prefer audio-only formats (no video)
            audio_only = [f for f in formats if f.get('vcodec') == 'none' and f.get('acodec') != 'none']
            if audio_only:
                # Pick highest quality audio
                best = max(audio_only, key=lambda f: f.get('abr') or f.get('tbr') or 0)
                audio_url = best.get('url', '')
            if not audio_url:
                # Fall back to any format with audio
                audio_url = info.get('url', '')
            if audio_url:
                set_cached_yt_url(key, audio_url)
                print(f'YouTube fallback OK for: {title} — {artist}')
            return audio_url
    except Exception as e:
        print(f'YouTube fallback error: {e}')
        return ''


@app.route('/api/youtube-fallback', methods=['GET'])
def youtube_fallback():
    """Explicit endpoint: /api/youtube-fallback?title=...&artist=...
    Returns { success, url } for the frontend to stream directly."""
    title  = request.args.get('title',  '').strip()
    artist = request.args.get('artist', '').strip()
    if not title:
        return jsonify({'success': False, 'error': 'title is required'}), 400
    url = youtube_get_audio_url(title, artist)
    if url:
        return jsonify({'success': True, 'url': url, 'source': 'youtube'})
    return jsonify({'success': False, 'error': 'Could not find on YouTube'}), 404


# ─── Diagnostics ──────────────────────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    db_ok = False
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute('SELECT 1'); cur.close(); conn.close()
        db_ok = True
    except Exception as e:
        pass
    return jsonify({'status': 'ok', 'backend': 'JioSaavn + PostgreSQL', 'db': 'connected' if db_ok else 'error'})

@app.route('/api/test-db', methods=['GET'])
def test_db():
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute('SELECT COUNT(*) FROM users')
        row = cur.fetchone()
        cur.close(); conn.close()
        count = row[0] if row else 0
        return jsonify({'success': True, 'message': 'PostgreSQL connected!', 'user_count': count})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ─── Auth Routes ──────────────────────────────────────────────────────────────

@app.route('/api/auth/register', methods=['POST'])
def register():
    try:
        data     = request.get_json() or {}
        email    = data.get('email', '').strip().lower()
        password = data.get('password', '').strip()
        username = data.get('username', '').strip() or email.split('@')[0]

        if not email or not password:
            return jsonify({'success': False, 'error': 'Email and password required'})
        if len(password) < 6:
            return jsonify({'success': False, 'error': 'Password must be at least 6 characters'})
        if db_get_user_by_email(email):
            return jsonify({'success': False, 'error': 'Email already registered'})

        user_id = str(uuid.uuid4())
        hashed  = hash_password(password)

        conn = get_db(); cur = conn.cursor()
        cur.execute(
            "INSERT INTO users (id, email, password_hash, username) VALUES (%s, %s, %s, %s)",
            (user_id, email, hashed, username)
        )
        conn.commit(); cur.close(); conn.close()

        token = create_token(user_id)
        return jsonify({'success': True, 'token': token, 'userId': user_id, 'username': username})
    except Exception as e:
        print(f'Register error: {e}')
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/auth/login', methods=['POST'])
def login():
    try:
        data     = request.get_json() or {}
        email    = data.get('email', '').strip().lower()
        password = data.get('password', '').strip()

        if not email or not password:
            return jsonify({'success': False, 'error': 'Email and password required'})

        user = db_get_user_by_email(email)
        if not user:
            return jsonify({'success': False, 'error': 'Invalid email or password'})
        if not verify_password(user['password_hash'], password):
            return jsonify({'success': False, 'error': 'Invalid email or password'})

        token = create_token(user['id'])
        return jsonify({'success': True, 'token': token, 'userId': user['id'], 'username': user.get('username', '')})
    except Exception as e:
        print(f'Login error: {e}')
        return jsonify({'success': False, 'error': str(e)}), 500

# ─── User Data Routes ─────────────────────────────────────────────────────────

import json as _json

@app.route('/api/user/profile', methods=['GET'])
@user_required
def get_profile(user):
    return jsonify({'success': True, 'data': {
        'id': user['id'], 'email': user['email'], 'username': user['username'],
        'settings': user.get('settings') or {},
    }})


@app.route('/api/user/favorites', methods=['GET'])
@user_required
def get_favorites(user):
    return jsonify({'success': True, 'data': {'favorites': user.get('favorites') or []}})


@app.route('/api/user/favorites', methods=['POST'])
@user_required
def toggle_favorite(user):
    song    = request.get_json() or {}
    song_id = song.get('id', '')
    if not song_id:
        return jsonify({'success': False, 'error': 'No song id'})

    favs   = user.get('favorites') or []
    exists = next((f for f in favs if f['id'] == song_id), None)

    if exists:
        favs   = [f for f in favs if f['id'] != song_id]
        action = 'removed'
    else:
        favs.append({k: song.get(k, '') for k in ['id', 'title', 'artist', 'image']})
        action = 'added'

    db_update_user(user['id'], favorites=_json.dumps(favs))
    return jsonify({'success': True, 'action': action, 'data': {'favorites': favs}})


@app.route('/api/user/playlists', methods=['GET'])
@user_required
def get_playlists(user):
    return jsonify({'success': True, 'data': {'playlists': user.get('playlists') or []}})


@app.route('/api/user/playlists', methods=['POST'])
@user_required
def create_playlist(user):
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    song = data.get('song', None)
    if not name:
        return jsonify({'success': False, 'error': 'Playlist name required'})

    playlists = user.get('playlists') or []
    playlist  = {'id': str(uuid.uuid4()), 'name': name, 'songs': [song] if song else []}
    playlists.append(playlist)

    db_update_user(user['id'], playlists=_json.dumps(playlists))
    return jsonify({'success': True, 'data': {'playlists': playlists}})


@app.route('/api/user/playlists/<playlist_id>/songs', methods=['POST'])
@user_required
def add_to_playlist(user, playlist_id):
    song    = request.get_json() or {}
    song_id = song.get('id', '')
    if not song_id:
        return jsonify({'success': False, 'error': 'No song id'})

    playlists = user.get('playlists') or []
    for pl in playlists:
        if pl['id'] == playlist_id:
            if not any(s['id'] == song_id for s in pl.get('songs', [])):
                pl['songs'].append({k: song.get(k, '') for k in ['id', 'title', 'artist', 'image']})
            break

    db_update_user(user['id'], playlists=_json.dumps(playlists))
    return jsonify({'success': True, 'data': {'playlists': playlists}})


@app.route('/api/user/playlists/<playlist_id>', methods=['DELETE'])
@user_required
def delete_playlist(user, playlist_id):
    """Delete a playlist by its ID."""
    playlists = user.get('playlists') or []
    playlists = [p for p in playlists if p['id'] != playlist_id]
    db_update_user(user['id'], playlists=_json.dumps(playlists))
    return jsonify({'success': True, 'data': {'playlists': playlists}})


@app.route('/api/user/history', methods=['GET'])
@user_required
def get_history(user):
    history = user.get('history') or []
    return jsonify({'success': True, 'data': {'history': history[-50:][::-1]}})


@app.route('/api/user/history', methods=['POST'])
@user_required
def add_history(user):
    song    = request.get_json() or {}
    song_id = song.get('id', '')
    if not song_id:
        return jsonify({'success': False, 'error': 'No song id'})

    mood    = detect_mood(song.get('title', ''), song.get('artist', ''))
    entry   = {
        'id': song_id, 'title': song.get('title', ''), 'artist': song.get('artist', ''),
        'image': song.get('image', ''), 'mood': mood, 'played_at': datetime.utcnow().isoformat(),
    }
    history = user.get('history') or []
    history.append(entry)
    history = history[-100:]  # Keep last 100

    db_update_user(user['id'], history=_json.dumps(history))
    return jsonify({'success': True, 'mood': mood, 'mood_label': MOOD_LABELS.get(mood, '')})


@app.route('/api/user/downloads', methods=['GET'])
@user_required
def get_downloads(user):
    return jsonify({'success': True, 'data': {'downloads': user.get('downloads') or []}})


@app.route('/api/user/downloads', methods=['POST'])
@user_required
def save_download(user):
    song    = request.get_json() or {}
    song_id = song.get('id', '')
    if not song_id:
        return jsonify({'success': False, 'error': 'No song id'})

    downloads = user.get('downloads') or []
    if not any(d['id'] == song_id for d in downloads):
        downloads.append({k: song.get(k, '') for k in ['id', 'title', 'artist', 'image', 'localUri']})

    db_update_user(user['id'], downloads=_json.dumps(downloads))
    return jsonify({'success': True, 'data': {'downloads': downloads}})


@app.route('/api/user/downloads/<song_id>', methods=['DELETE'])
@user_required
def delete_download(user, song_id):
    """Remove a specific song from the user's downloads list."""
    downloads = user.get('downloads') or []
    downloads = [d for d in downloads if d['id'] != song_id]
    db_update_user(user['id'], downloads=_json.dumps(downloads))
    return jsonify({'success': True, 'data': {'downloads': downloads}})



@app.route('/api/user/settings', methods=['POST'])
@user_required
def update_settings(user):
    data     = request.get_json() or {}
    settings = user.get('settings') or {'shake_enabled': False, 'smart_autoplay': True}
    if 'shake_enabled'  in data: settings['shake_enabled']  = bool(data['shake_enabled'])
    if 'smart_autoplay' in data: settings['smart_autoplay'] = bool(data['smart_autoplay'])
    db_update_user(user['id'], settings=_json.dumps(settings))
    return jsonify({'success': True, 'data': {'settings': settings}})

# ─── Recommendation / Autoplay ────────────────────────────────────────────────

@app.route('/api/autoplay', methods=['GET'])
def autoplay():
    song_id       = request.args.get('songId', '').strip()
    user_id       = request.args.get('userId', '').strip()
    mood_override = request.args.get('mood',   '').strip()

    exclude_ids = set()
    user_mood   = mood_override or None
    is_time_based = False

    if user_id:
        try:
            user = db_get_user_by_id(user_id)
            if user:
                history = user.get('history') or []
                exclude_ids = {h['id'] for h in history[-20:]}
                if not user_mood and history:
                    recent_moods = [h.get('mood', 'default') for h in history[-10:]]
                    user_mood = max(set(recent_moods), key=recent_moods.count)
        except Exception:
            pass

    if not user_mood or user_mood == 'default':
        user_mood = get_time_of_day_mood()
        is_time_based = True

    query   = get_query_for_mood(user_mood)
    results = get_cached_search(query)
    if not results:
        # JioSaavn is fast and reliable for Hindi mood queries
        results = jiosaavn_search(query)
        if not results:
            # Fallback to YouTube if JioSaavn fails
            results = youtube_search_songs(query, max_results=10)
        if results:
            set_cached_search(query, results)

    filtered = [s for s in results if s['id'] not in exclude_ids] or results
    if not filtered:
        return jsonify({'success': False, 'error': 'No recommendations found'})

    song   = random.choice(filtered)
    reason = build_recommendation_reason(user_mood, is_time_based)

    return jsonify({
        'success': True, 'song': song, 'mood': user_mood,
        'mood_label': MOOD_LABELS.get(user_mood, ''), 'reason': reason,
    })


@app.route('/api/recommendations/queue', methods=['GET'])
def recommendations_queue():
    song_id = request.args.get('songId', '').strip()
    mood    = request.args.get('mood',   '').strip() or get_time_of_day_mood()
    exclude_ids = {song_id} if song_id else set()

    query   = get_query_for_mood(mood)
    results = get_cached_search(query)
    if not results:
        # JioSaavn is fast + reliable for mood queries — powers the Up Next queue
        results = jiosaavn_search(query)
        if not results:
            results = youtube_search_songs(query, max_results=10)
        if results:
            set_cached_search(query, results)

    filtered = [s for s in results if s['id'] not in exclude_ids]
    if not filtered:
        filtered = results  # if all excluded, use all
    queue = random.sample(filtered, min(3, len(filtered)))
    return jsonify({'success': True, 'queue': queue, 'mood': mood})

# ─── JioSaavn Music Routes ────────────────────────────────────────────────────

@app.route('/api/search', methods=['GET'])
def search():
    """YouTube-only search via yt-dlp — always playable, exact song matches."""
    query = request.args.get('query', '').strip()
    if not query:
        return jsonify({'success': False, 'error': 'No query provided'})
    cached = get_cached_search(query)
    if cached is not None:
        return jsonify({'success': True, 'data': {'results': cached}})
    try:
        results = youtube_search_songs(query, max_results=15)
        if not results:
            return jsonify({'success': True, 'data': {'results': []}})
        set_cached_search(query, results)
        return jsonify({'success': True, 'data': {'results': results}})
    except Exception as e:
        print(f'Search error: {e}')
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/random', methods=['GET'])
def random_song():
    genres = ['Arijit Singh best songs', 'Trending Bollywood 2024 hits', 'AR Rahman music', 'latest hindi songs 2024']
    query  = random.choice(genres)
    cached = get_cached_search(query)
    if cached:
        return jsonify({'success': True, 'data': {'song': random.choice(cached)}})
    try:
        songs = jiosaavn_search(query)
        if not songs:
            songs = youtube_search_songs(query, max_results=10)
        if not songs:
            return jsonify({'success': False, 'error': 'No tracks found'})
        set_cached_search(query, songs)
        return jsonify({'success': True, 'data': {'song': random.choice(songs)}})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


# ─── Artist Routes ────────────────────────────────────────────────────────────

TOP_BOLLYWOOD_ARTISTS = [
    {'name': 'Arijit Singh',      'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Arijit_Singh_at_the_IIFA_Awards_%282019%29.jpg/440px-Arijit_Singh_at_the_IIFA_Awards_%282019%29.jpg'},
    {'name': 'Atif Aslam',        'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Atif_Aslam_in_2020.jpg/440px-Atif_Aslam_in_2020.jpg'},
    {'name': 'AR Rahman',         'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/A_R_Rahman_in_2018.jpg/440px-A_R_Rahman_in_2018.jpg'},
    {'name': 'Sonu Nigam',        'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Sonu_Nigam_-_Dhaka%2C_2012.jpg/440px-Sonu_Nigam_-_Dhaka%2C_2012.jpg'},
    {'name': 'Shreya Ghoshal',    'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Shreya_Ghoshal_in_2018_%28cropped%29.jpg/440px-Shreya_Ghoshal_in_2018_%28cropped%29.jpg'},
    {'name': 'Kumar Sanu',        'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Kumar_Sanu.jpg/440px-Kumar_Sanu.jpg'},
    {'name': 'Jubin Nautiyal',    'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Jubin_Nautiyal_at_Filmfare_2020.jpg/440px-Jubin_Nautiyal_at_Filmfare_2020.jpg'},
    {'name': 'Neha Kakkar',       'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Neha_Kakkar_2019.jpg/440px-Neha_Kakkar_2019.jpg'},
    {'name': 'Udit Narayan',      'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Udit_narayan.jpg/440px-Udit_narayan.jpg'},
    {'name': 'Lata Mangeshkar',   'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Lata_Mangeshkar_in_2019.jpg/440px-Lata_Mangeshkar_in_2019.jpg'},
    {'name': 'Kishore Kumar',     'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Kishore_Kumar_1985.jpg/440px-Kishore_Kumar_1985.jpg'},
    {'name': 'Alka Yagnik',       'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/19/Alka_Yagnik.jpg/440px-Alka_Yagnik.jpg'},
    {'name': 'Badshah',           'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Badshah_at_Global_Citizen_Festival_2016.jpg/440px-Badshah_at_Global_Citizen_Festival_2016.jpg'},
    {'name': 'Diljit Dosanjh',    'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Diljit_Dosanjh_2019.jpg/440px-Diljit_Dosanjh_2019.jpg'},
    {'name': 'Armaan Malik',      'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Armaan_Malik_in_2017.jpg/440px-Armaan_Malik_in_2017.jpg'},
    {'name': 'Mohit Chauhan',     'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Mohit_Chauhan.jpg/440px-Mohit_Chauhan.jpg'},
    {'name': 'Vishal Dadlani',    'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Vishal_Dadlani_at_Sa_Re_Ga_Ma_Pa.jpg/440px-Vishal_Dadlani_at_Sa_Re_Ga_Ma_Pa.jpg'},
    {'name': 'Sunidhi Chauhan',   'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Sunidhi_Chauhan.jpg/440px-Sunidhi_Chauhan.jpg'},
    {'name': 'Darshan Raval',     'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Darshan_Raval_2019.jpg/440px-Darshan_Raval_2019.jpg'},
    {'name': 'Yo Yo Honey Singh', 'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Honey_Singh_at_BIG_Star_Entertainment_Awards.jpg/440px-Honey_Singh_at_BIG_Star_Entertainment_Awards.jpg'},
]


@app.route('/api/artists/top', methods=['GET'])
def top_artists():
    """Returns the predefined list of top Bollywood artists."""
    return jsonify({'success': True, 'artists': TOP_BOLLYWOOD_ARTISTS})


@app.route('/api/artist', methods=['GET'])
def artist_tracks():
    """Search JioSaavn for an artist's top songs."""
    name = request.args.get('name', '').strip()
    if not name:
        return jsonify({'success': False, 'error': 'No artist name provided'})

    cache_key = f'artist:{name.lower()}'
    cached = get_cached_search(cache_key)
    if cached is not None:
        return jsonify({'success': True, 'artist': {'name': name}, 'tracks': cached})

    # Search JioSaavn for top songs by this artist
    songs = jiosaavn_search(f'{name} best songs')
    if not songs:
        songs = jiosaavn_search(name)
    if not songs:
        songs = youtube_search_songs(f'{name} songs', max_results=15)

    if songs:
        set_cached_search(cache_key, songs)

    return jsonify({'success': True, 'artist': {'name': name}, 'tracks': songs})


@app.route('/api/stream', methods=['GET'])
def stream_audio():
    song_id = request.args.get('id',     '').strip()
    title   = request.args.get('title',  '').strip()
    artist  = request.args.get('artist', '').strip()
    if not song_id:
        return 'Missing song id', 400

    audio_url = ''
    source    = 'jiosaavn'

    # Songs sourced from YouTube search have a 'yt_' prefix — go straight to yt-dlp
    if song_id.startswith('yt_'):
        yt_id = song_id[3:]  # strip the 'yt_' prefix to get the real YouTube video ID
        print(f'Direct YouTube stream for video ID: {yt_id}')
        # Use title|artist key for cache; fall back to video URL if title missing
        cache_key = f'{title.lower().strip()}|{artist.lower().strip()}' if title else yt_id
        audio_url = get_cached_yt_url(cache_key)
        if not audio_url:
            try:
                import yt_dlp
                ydl_opts = {
                    'format': 'bestaudio/best',
                    'quiet': True,
                    'no_warnings': True,
                    'noplaylist': True,
                    'extract_flat': False,
                    'skip_download': True,
                    'socket_timeout': 15,
                }
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(f'https://www.youtube.com/watch?v={yt_id}', download=False)
                    if info:
                        formats = info.get('formats', [])
                        audio_only = [f for f in formats if f.get('vcodec') == 'none' and f.get('acodec') != 'none']
                        if audio_only:
                            best = max(audio_only, key=lambda f: f.get('abr') or f.get('tbr') or 0)
                            audio_url = best.get('url', '')
                        if not audio_url:
                            audio_url = info.get('url', '')
                        if audio_url:
                            set_cached_yt_url(cache_key, audio_url)
            except Exception as e:
                print(f'Direct YouTube stream error: {e}')
        source = 'youtube'
    else:
        # 1️⃣  Try JioSaavn first
        audio_url = jiosaavn_get_audio_url(song_id)
        source    = 'jiosaavn'

        # 2️⃣  Auto-fallback to YouTube if JioSaavn returned nothing
        if not audio_url and title:
            print(f'JioSaavn failed for {song_id} — trying YouTube fallback')
            audio_url = youtube_get_audio_url(title, artist)
            source    = 'youtube'

    if not audio_url:
        return 'Could not resolve audio URL from JioSaavn or YouTube', 404

    try:
        # Proxy the audio stream through the server — bypasses YouTube 403 errors
        range_header = request.headers.get('Range', 'bytes=0-')
        proxy_headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
            'Accept-Encoding': 'identity',
        }
        if range_header:
            proxy_headers['Range'] = range_header

        req = http_requests.get(audio_url, stream=True, headers=proxy_headers, timeout=30)

        def generate():
            for chunk in req.iter_content(chunk_size=65536):
                if chunk:
                    yield chunk

        resp_headers = {
            'Content-Type':  req.headers.get('Content-Type', 'audio/mpeg'),
            'Accept-Ranges': 'bytes',
            'X-Audio-Source': source,
        }
        if 'Content-Range'  in req.headers: resp_headers['Content-Range']  = req.headers['Content-Range']
        if 'Content-Length' in req.headers: resp_headers['Content-Length'] = req.headers['Content-Length']
        status = req.status_code if req.status_code in (200, 206) else 200
        return Response(generate(), status=status, headers=resp_headers)
    except Exception as e:
        return f'Streaming error: {str(e)}', 500


@app.route('/api/refresh', methods=['GET'])
def refresh_url():
    song_id = request.args.get('id', '').strip()
    if not song_id:
        return jsonify({'success': False, 'error': 'No id provided'})
    url_cache.pop(song_id, None)
    return jsonify({'success': True, 'data': {'url': f"{request.host_url}api/stream?id={song_id}"}})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)