"""
Zyra Backend — Flask server with:
  • JioSaavn music search + streaming
  • JWT Email/Password authentication
  • Per-user PostgreSQL data (favorites, playlists, history, downloads)
  • Smart mood-based autoplay recommendations
"""

from flask import Flask, request, jsonify, Response, redirect
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

@app.route('/assets/kk_profile.png')
def serve_kk_profile():
    return send_file('kk_profile.png', mimetype='image/png')

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
        timeout=15
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
YT_URL_CACHE_TTL  = 1800  # 30 min — Invidious itags don’t expire
search_cache  = {}
url_cache     = {}
yt_url_cache  = {}         # keyed by "title|artist"
_artist_img_cache: dict = {}  # keyed by artist name

# ─── saavn.dev API (BlackHole-compatible) ────────────────────────────────────
# Community-maintained JioSaavn wrapper used by BlackHole, SongTube, etc.
# Returns decrypted 320kbps stream URLs — no DES crypto needed on our side.

SAAVNDEV_BASE = 'https://saavn.dev'

def _sd_best_image(images: list) -> str:
    """Pick highest resolution image from saavn.dev image array."""
    if not images:
        return ''
    for q in ['500x500', '150x150', '50x50']:
        for img in images:
            if img.get('quality', '') == q:
                return img.get('url', img.get('link', ''))
    return images[-1].get('url', images[-1].get('link', ''))

def _sd_best_url(download_urls: list) -> str:
    """Pick 320kbps stream URL from saavn.dev downloadUrl array."""
    if not download_urls:
        return ''
    # Prefer 320kbps
    for dl in download_urls:
        if '320' in str(dl.get('quality', '')):
            return dl.get('url', dl.get('link', ''))
    # Fallback: last (usually highest)
    for dl in reversed(download_urls):
        u = dl.get('url', dl.get('link', ''))
        if u:
            return u
    return ''

def saavn_dev_search(query: str, limit: int = 20) -> list:
    """Search songs via saavn.dev — returns clean objects with 320kbps URLs."""
    try:
        r = http_requests.get(
            f'{SAAVNDEV_BASE}/api/search/songs',
            params={'query': query, 'page': 0, 'limit': limit},
            timeout=10,
        )
        if r.status_code != 200:
            return []
        data = r.json()
        raw = (data.get('data') or {}).get('results', [])
        results = []
        for song in raw:
            sid = song.get('id', '')
            if not sid:
                continue
            # Artist name
            artists = song.get('artists', {})
            primary = artists.get('primary', [])
            artist = ', '.join([a['name'] for a in primary if a.get('name')])
            if not artist:
                artist = clean_html(song.get('primaryArtists', '') or 'Unknown')
            title = clean_html(song.get('name', '') or 'Unknown')
            image = _sd_best_image(song.get('image', []))
            # Include direct 320kbps CDN URL from search result — eliminates 15s stream-resolve delay
            url = _sd_best_url(song.get('downloadUrl', []))
            results.append({
                'id':     sid,
                'title':  title,
                'artist': artist,
                'image':  image,
                'url':    url or None,
                'source': 'jiosaavn',
            })
        return results
    except Exception as e:
        print(f'saavn.dev search error: {e}')
        return []

def saavn_dev_get_song_url(song_id: str) -> str:
    """Fetch 320kbps URL from saavn.dev — no DES decryption needed."""
    cached = get_cached_url(song_id)
    if cached:
        return cached
    try:
        r = http_requests.get(
            f'{SAAVNDEV_BASE}/api/songs/{song_id}',
            timeout=8,
        )
        data = r.json()
        songs_data = data.get('data', [])
        if isinstance(songs_data, dict):
            songs_data = [songs_data]
        if not songs_data:
            return ''
        url = _sd_best_url(songs_data[0].get('downloadUrl', []))
        if url:
            set_cached_url(song_id, url)
        return url
    except Exception as e:
        print(f'saavn.dev get song URL error: {e}')
        return ''

def saavn_dev_artist_songs(artist_name: str, max_songs: int = 50) -> list:
    """Get artist discography from saavn.dev (artist search → top songs)."""
    try:
        # Step 1: Find artist ID
        r = http_requests.get(
            f'{SAAVNDEV_BASE}/api/search/artists',
            params={'query': artist_name, 'page': 0, 'limit': 1},
            timeout=8,
        )
        data = r.json()
        artists_list = (data.get('data') or {}).get('results', [])
        if not artists_list:
            return []
        artist_id = artists_list[0].get('id', '')
        if not artist_id:
            return []

        # Step 2: Paginate through top songs
        all_songs: list = []
        for page in range(4):  # up to 4 pages (typically 10 songs/page)
            if len(all_songs) >= max_songs:
                break
            try:
                r2 = http_requests.get(
                    f'{SAAVNDEV_BASE}/api/artists/{artist_id}/songs',
                    params={'page': page, 'sortBy': 'popularity', 'sortOrder': 'desc'},
                    timeout=8,
                )
                data2 = r2.json()
                songs_raw = (data2.get('data') or {}).get('songs', [])
                if not songs_raw:
                    break
                for song in songs_raw:
                    sid = song.get('id', '')
                    if not sid:
                        continue
                    a_info  = song.get('artists', {})
                    primary = a_info.get('primary', [])
                    artist  = ', '.join([a['name'] for a in primary if a.get('name')]) or artist_name
                    title   = clean_html(song.get('name', '') or 'Unknown')
                    image   = _sd_best_image(song.get('image', []))
                    all_songs.append({
                        'id': sid, 'title': title, 'artist': artist,
                        'image': image, 'url': None, 'source': 'jiosaavn',
                    })
                    if len(all_songs) >= max_songs:
                        break
            except Exception:
                break
        return all_songs
    except Exception as e:
        print(f'saavn.dev artist songs error: {e}')
        return []


def saavn_dev_album_search(query: str, limit: int = 5) -> list:
    """Search movie/album playlists via saavn.dev — for grouping songs by film."""
    try:
        r = http_requests.get(
            f'{SAAVNDEV_BASE}/api/search/albums',
            params={'query': query, 'page': 0, 'limit': limit},
            timeout=10,
        )
        if r.status_code != 200:
            return []
        data = r.json()
        raw = (data.get('data') or {}).get('results', [])
        albums = []
        for album in raw:
            album_id = album.get('id', '')
            if not album_id:
                continue
            name  = clean_html(album.get('name', '') or 'Unknown')
            image = _sd_best_image(album.get('image', []))
            albums.append({'id': album_id, 'name': name, 'image': image})
        return albums
    except Exception as e:
        print(f'saavn.dev album search error: {e}')
        return []

@app.route('/api/albums/<album_id>', methods=['GET'])
def get_album_details(album_id):
    """Fetch album details and its tracks from JioSaavn natively."""
    try:
        resp = http_requests.get(
            'https://www.jiosaavn.com/api.php',
            params={
                '__call': 'content.getAlbumDetails',
                'albumid': album_id,
                '_format': 'json',
                '_marker': '0',
                'ctx': 'android'
            },
            headers=JIOSAAVN_HEADERS, timeout=8
        )
        data = resp.json()
        
        album_info = {
            'id': data.get('albumid'),
            'name': clean_html(data.get('title', '') or data.get('name', '') or ''),
            'year': data.get('year', ''),
            'artist': clean_html(data.get('primary_artists', '')),
            'image': upgrade_image_url(data.get('image', '')),
        }
        
        songs_raw = data.get('songs', [])
        songs = []
        for s in songs_raw:
            s_id = s.get('id')
            if not s_id: continue
            title = clean_html(s.get('song', '') or s.get('title', '') or '')
            artist = clean_html(s.get('primary_artists', '') or s.get('singers', '') or '')
            image = upgrade_image_url(s.get('image', ''))
            
            # Fetch direct decrypted URL if possible
            audio_url = ''
            
            songs.append({
                'id': s_id,
                'title': title,
                'artist': artist,
                'image': image,
                'url': audio_url,
                'duration': int(s.get('duration', 0)),
                'source': 'jiosaavn'
            })
            
        album_info['songs'] = songs
        return jsonify({'success': True, 'data': album_info})
    except Exception as e:
        print(f'Album fetch error: {e}')
        return jsonify({'success': False, 'error': str(e)})


# ─── Invidious instances (YouTube proxy — used for yt_ songs) ────────────────
INVIDIOUS_INSTANCES = [
    'https://invidious.kavin.rocks',
    'https://inv.riverside.rocks',
    'https://invidious.privacydev.net',
    'https://yt.cdaut.de',
]
_invidious_itag_cache: dict = {}  # video_id → {instance, itag, ts}

def get_invidious_audio(video_id: str):
    """Return (instance_base, itag) from Invidious API. Prefers m4a audio."""
    cached = _invidious_itag_cache.get(video_id)
    if cached and time.time() - cached['ts'] < 3600:
        return cached['instance'], cached['itag']
    for base in INVIDIOUS_INSTANCES:
        try:
            r = http_requests.get(
                f'{base}/api/v1/videos/{video_id}',
                params={'fields': 'adaptiveFormats'},
                timeout=10
            )
            if r.status_code != 200:
                continue
            formats = r.json().get('adaptiveFormats', [])
            m4a  = [f for f in formats if f.get('type', '').startswith('audio/mp4')]
            webm = [f for f in formats if f.get('type', '').startswith('audio/webm')]
            pool = m4a or webm or []
            if pool:
                best = sorted(pool, key=lambda x: int(x.get('bitrate', 0)), reverse=True)[0]
                itag = best.get('itag')
                _invidious_itag_cache[video_id] = {'instance': base, 'itag': itag, 'ts': time.time()}
                return base, itag
        except Exception:
            continue
    return None, None


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

def jiosaavn_search_all(query: str):
    """Search JioSaavn autocomplete API for songs, albums, and artists all at once."""
    try:
        resp = http_requests.get(
            'https://www.jiosaavn.com/api.php',
            params={'__call': 'autocomplete.get', 'query': query,
                    '_format': 'json', '_marker': '0', 'ctx': 'android'},
            headers=JIOSAAVN_HEADERS, timeout=8
        )
        data = resp.json()
        
        # ── Parse Songs ──
        songs_raw = data.get('songs', {}).get('data', [])
        songs = []
        song_ids = []
        for song in songs_raw[:15]:
            song_id = song.get('id', '')
            if song_id:
                song_ids.append(song_id)
            title   = clean_html(song.get('title', '') or song.get('song', '') or 'Unknown')
            artist  = clean_html(song.get('more_info', {}).get('singers', '') or song.get('description', '') or 'Unknown')
            image   = upgrade_image_url(song.get('image', ''))
            songs.append({'id': song_id, 'title': title, 'artist': artist, 'image': image, 'url': None, 'source': 'jiosaavn'})
            
        # Batch fetch details to get encrypted_media_url for instant playback
        if song_ids:
            try:
                det_resp = http_requests.get(
                    'https://www.jiosaavn.com/api.php',
                    params={'__call': 'song.getDetails', 'cc': 'in', '_bit_rate': '320',
                            '_format': 'json', 'pids': ','.join(song_ids), 'ctx': 'android', '_marker': '0'},
                    headers=JIOSAAVN_HEADERS, timeout=5
                )
                det_data = det_resp.json()
                for s in songs:
                    s_data = det_data.get(s['id'], {})
                    enc = s_data.get('encrypted_media_url', '')
                    if enc:
                        s['url'] = decrypt_jiosaavn_url(enc)
            except Exception as e:
                print(f"Batch details fetch error: {e}")
            
        # ── Parse Albums ──
        albums_raw = data.get('albums', {}).get('data', [])
        albums = []
        for alb in albums_raw[:10]:
            alb_id = alb.get('id', '')
            title  = clean_html(alb.get('title', '') or 'Unknown')
            music  = clean_html(alb.get('music', '') or alb.get('description', '') or 'Unknown')
            image  = upgrade_image_url(alb.get('image', ''))
            albums.append({'id': alb_id, 'name': title, 'artist': music, 'image': image, 'source': 'jiosaavn'})
            
        # ── Parse Artists ──
        artists_raw = data.get('artists', {}).get('data', [])
        artists = []
        for art in artists_raw[:10]:
            art_id = art.get('id', '')
            title  = clean_html(art.get('title', '') or 'Unknown')
            image  = upgrade_image_url(art.get('image', ''))
            # Some artists have no image or default image, keep it
            artists.append({'id': art_id, 'name': title, 'image': image, 'source': 'jiosaavn'})

        return {'songs': songs, 'albums': albums, 'artists': artists}
    except Exception as e:
        print(f"jiosaavn_search_all error: {e}")
        return {'songs': [], 'albums': [], 'artists': []}

def jiosaavn_search(query: str):
    """Fallback search function returning only songs."""
    return jiosaavn_search_all(query).get('songs', [])


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
        audio_url = ''
        if encrypted:
            audio_url = decrypt_jiosaavn_url(encrypted)
        
        if not audio_url:
            # Fallback to preview url hack
            preview = song_data.get('media_preview_url', '')
            if preview:
                audio_url = preview.replace('preview.saavncdn.com', 'aac.saavncdn.com').replace('_96_p.mp4', '_320.mp4')
                
        if not audio_url:
            audio_url = song_data.get('media_url', '')
            
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


# ─── Forgot Password / OTP ────────────────────────────────────────────────────

import smtplib
from email.mime.text import MIMEText
import secrets

_otp_store: dict = {}   # email → {otp, expires_at, user_id, verified}
OTP_EXPIRY_SECONDS = 600  # 10 minutes

EMAIL_HOST     = os.environ.get('EMAIL_HOST',     'smtp.gmail.com')
EMAIL_PORT     = int(os.environ.get('EMAIL_PORT', 587))
EMAIL_FROM     = os.environ.get('EMAIL_FROM',     '')
EMAIL_PASSWORD = os.environ.get('EMAIL_PASSWORD', '')


def send_otp_email(to_email: str, otp: str) -> bool:
    """Send OTP via Resend API (since Render blocks standard SMTP)."""
    RESEND_API_KEY = os.environ.get('RESEND_API_KEY', '')
    if not RESEND_API_KEY or not EMAIL_FROM:
        print(f'[OTP DEBUG] OTP for {to_email}: {otp}')  # dev fallback
        return True
    try:
        html_body = f"""
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Zyra Music Password Reset</h2>
            <p>Your password reset OTP is:</p>
            <h1 style="color: #00ffcc; background: #050515; padding: 10px; display: inline-block; border-radius: 5px;">{otp}</h1>
            <p>This code expires in 10 minutes.</p>
            <p>If you did not request this, please ignore this email.</p>
        </div>
        """
        payload = {
            "from": f"Zyra Music <{EMAIL_FROM}>",
            "to": [to_email],
            "subject": "Zyra Music — Password Reset OTP",
            "html": html_body
        }
        headers = {
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json"
        }
        import requests
        r = requests.post('https://api.resend.com/emails', json=payload, headers=headers, timeout=10)
        r.raise_for_status()
        return True
    except Exception as e:
        print(f'Resend email error: {e}')
        return False

@app.route('/api/auth/test-resend', methods=['GET'])
def test_resend():
    RESEND_API_KEY = os.environ.get('RESEND_API_KEY', '')
    EMAIL_FROM = os.environ.get('EMAIL_FROM', '')
    if not RESEND_API_KEY: return jsonify({'success': False, 'error': 'No RESEND_API_KEY found'})
    
    payload = {
        "from": f"Zyra Music <{EMAIL_FROM}>",
        "to": ["babulal1975@gmail.com"], # A dummy destination just to test the API acceptance
        "subject": "Test",
        "html": "<p>Test</p>"
    }
    headers = {
        "Authorization": f"Bearer {RESEND_API_KEY}",
        "Content-Type": "application/json"
    }
    import requests
    try:
        r = requests.post('https://api.resend.com/emails', json=payload, headers=headers, timeout=10)
        return jsonify({'success': r.status_code == 200, 'status': r.status_code, 'response': r.text})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/auth/test-smtp', methods=['GET'])
def test_smtp():
    try:
        if not EMAIL_FROM or not EMAIL_PASSWORD:
            return jsonify({'success': False, 'error': 'Environment variables EMAIL_FROM or EMAIL_PASSWORD are missing.'})
        with smtplib.SMTP(EMAIL_HOST, EMAIL_PORT, timeout=5) as server:
            server.ehlo()
            server.starttls()
            server.login(EMAIL_FROM, EMAIL_PASSWORD)
        return jsonify({'success': True, 'message': f'Successfully authenticated as {EMAIL_FROM}'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/auth/forgot-password', methods=['POST'])
def forgot_password():
    data  = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    if not email:
        return jsonify({'success': False, 'error': 'Email required'})
    user = db_get_user_by_email(email)
    # Immediately tell the user if the email is not registered
    if not user:
        return jsonify({'success': False, 'error': 'This email is not registered. Please sign up first.'})
    otp = ''.join([str(secrets.randbelow(10)) for _ in range(6)])
    _otp_store[email] = {
        'otp': otp, 'user_id': user['id'],
        'expires_at': time.time() + OTP_EXPIRY_SECONDS, 'verified': False,
    }
    # Send email in background so the API returns instantly (prevents timeout)
    import threading
    threading.Thread(target=send_otp_email, args=(email, otp), daemon=True).start()
    return jsonify({'success': True, 'message': 'OTP sent to your email. Please check your inbox.'})


@app.route('/api/auth/verify-otp', methods=['POST'])
def verify_otp():
    data  = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    otp   = data.get('otp',   '').strip()
    if not email or not otp:
        return jsonify({'success': False, 'error': 'Email and OTP required'})
    stored = _otp_store.get(email)
    if not stored:
        return jsonify({'success': False, 'error': 'No OTP requested. Please try again.'})
    if time.time() > stored['expires_at']:
        _otp_store.pop(email, None)
        return jsonify({'success': False, 'error': 'OTP expired. Please request a new one.'})
    if stored['otp'] != otp:
        return jsonify({'success': False, 'error': 'Invalid OTP. Please try again.'})
    stored['verified'] = True
    return jsonify({'success': True, 'message': 'OTP verified successfully.'})


@app.route('/api/auth/reset-password', methods=['POST'])
def reset_password_route():
    data         = request.get_json() or {}
    email        = data.get('email',    '').strip().lower()
    otp          = data.get('otp',      '').strip()
    new_password = data.get('password', '').strip()
    if not email or not otp or not new_password:
        return jsonify({'success': False, 'error': 'All fields required'})
    if len(new_password) < 6:
        return jsonify({'success': False, 'error': 'Password must be at least 6 characters'})
    stored = _otp_store.get(email)
    if not stored or not stored.get('verified'):
        return jsonify({'success': False, 'error': 'Please verify OTP first'})
    if time.time() > stored['expires_at']:
        _otp_store.pop(email, None)
        return jsonify({'success': False, 'error': 'Session expired. Please start again.'})
    if stored['otp'] != otp:
        return jsonify({'success': False, 'error': 'OTP mismatch. Please verify OTP again.'})
    db_update_user(stored['user_id'], password_hash=hash_password(new_password))
    _otp_store.pop(email, None)
    return jsonify({'success': True, 'message': 'Password reset successfully! You can now login.'})

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


@app.route('/api/user/playlists/<playlist_id>/songs/<song_id>', methods=['DELETE'])
@user_required
def remove_song_from_playlist(user, playlist_id, song_id):
    """Remove a single song from a playlist by song_id."""
    playlists = user.get('playlists') or []
    for pl in playlists:
        if pl['id'] == playlist_id:
            pl['songs'] = [s for s in pl.get('songs', []) if str(s.get('id', '')) != str(song_id)]
            break
    db_update_user(user['id'], playlists=_json.dumps(playlists))
    return jsonify({'success': True, 'data': {'playlists': playlists}})

@app.route('/api/user/history', methods=['GET'])
@user_required
def get_history(user):
    history = user.get('history') or []
    return jsonify({'success': True, 'data': {'history': history[-1000:][::-1]}})


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
    history = history[-1000:]  # Keep last 1000

    db_update_user(user['id'], history=_json.dumps(history))
    return jsonify({'success': True, 'mood': mood, 'mood_label': MOOD_LABELS.get(mood, '')})


@app.route('/api/user/history/<song_id>', methods=['DELETE'])
@user_required
def delete_history(user, song_id):
    """Remove a specific song from the user's play history."""
    history = user.get('history') or []
    history = [h for h in history if h.get('id') != song_id]
    db_update_user(user['id'], history=_json.dumps(history))
    # Return newest-first, same as GET
    return jsonify({'success': True, 'data': {'history': history[-1000:][::-1]}})


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
        # saavn.dev returns direct CDN URLs — faster playback start
        results = saavn_dev_search(query, limit=20)
        if not results:
            results = jiosaavn_search(query)
        if not results:
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
        # saavn.dev returns direct CDN URLs — faster queue start
        results = saavn_dev_search(query, limit=20)
        if not results:
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

@app.route('/api/suggest', methods=['GET'])
def suggest():
    query = request.args.get('query', '').strip()
    if not query:
        return jsonify({'success': True, 'data': []})
    try:
        import urllib.parse
        url = f"https://www.jiosaavn.com/api.php?__call=autocomplete.get&query={urllib.parse.quote(query)}&_format=json&_marker=0&ctx=android"
        r = http_requests.get(url, timeout=5)
        data = r.json()
        suggestions = []
        for k in ['topquery', 'songs', 'albums', 'artists']:
            items = data.get(k, {}).get('data', [])
            for item in items:
                title = item.get('title', '')
                title = html.unescape(title)
                # Remove html tags
                title = re.sub(r'<[^>]+>', '', title)
                if title and title not in suggestions:
                    suggestions.append(title)
        return jsonify({'success': True, 'data': suggestions[:10]})
    except Exception as e:
        print("Suggest error:", e)
        return jsonify({'success': True, 'data': []})


@app.route('/api/playlists/search', methods=['GET'])
def search_playlists_jiosaavn():
    query = request.args.get('query', '')
    limit = int(request.args.get('limit', 20))
    import urllib.request, urllib.parse, json
    try:
        url = f'https://www.jiosaavn.com/api.php?__call=search.getPlaylistResults&q={urllib.parse.quote(query)}&p=1&n={limit}&_format=json&_marker=0&ctx=android'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req).read().decode('utf-8')
        data = json.loads(resp)
        results = data.get('results', [])
        playlists = []
        for p in results:
            img = p.get('image', '').replace('150x150', '500x500').replace('50x50', '500x500')
            playlists.append({
                'id': p.get('listid'),
                'title': p.get('listname') or p.get('title') or '',
                'subtitle': 'JioSaavn Playlist',
                'image': [{'quality': '500x500', 'url': img}]
            })
        return jsonify({'success': True, 'data': {'results': playlists}})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/playlists/<playlist_id>', methods=['GET'])
def get_playlist_details_jiosaavn(playlist_id):
    import urllib.request, json
    try:
        url = f'https://www.jiosaavn.com/api.php?__call=playlist.getDetails&listid={playlist_id}&_format=json&_marker=0&ctx=android'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req).read().decode('utf-8')
        data = json.loads(resp)
        songs = []
        if 'list' in data:
            raw_songs = data['list']
        else:
            raw_songs = [data[k] for k in data.keys() if k.isdigit()]
            
        for s in raw_songs:
            img = s.get('image', '').replace('150x150', '500x500').replace('50x50', '500x500')
            songs.append({
                'id': s.get('id'),
                'name': s.get('title') or s.get('song') or '',
                'artists': {'primary': [{'name': s.get('primary_artists') or s.get('singers') or ''}]},
                'image': [{'quality': '500x500', 'url': img}],
                'downloadUrl': [{'quality': '320kbps', 'url': s.get('url') or s.get('perma_url') or ''}],
                'duration': s.get('duration') or 0
            })
        return jsonify({'success': True, 'data': {'songs': songs}})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/search', methods=['GET'])
def search():
    """Search songs, albums, and artists via instant JioSaavn autocomplete fallback to YouTube."""
    query = request.args.get('query', '').strip()
    if not query:
        return jsonify({'success': False, 'error': 'No query provided'})

    cached = get_cached_search(query)
    if cached is not None:
        return jsonify({'success': True, 'data': cached})

    try:
        # ── Fast JioSaavn Autocomplete Search ──
        results = jiosaavn_search_all(query)
        
        # If no songs found, fallback to YouTube
        if not results['songs']:
            yt_songs = youtube_search_songs(query, max_results=15)
            if yt_songs:
                results['songs'] = yt_songs

        if results['songs'] or results['albums'] or results['artists']:
            set_cached_search(query, results)

        return jsonify({'success': True, 'data': results})
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
    {
        "name": "Arijit Singh",
        "image": "https://c.saavncdn.com/artists/Arijit_Singh_004_20241118063717_500x500.webp"
    },
    {
        "name": "Atif Aslam",
        "image": "https://c.saavncdn.com/artists/Atif_Aslam_500x500.jpg"
    },
    {
        "name": "AR Rahman",
        "image": "https://c.saavncdn.com/artists/AR_Rahman_002_20210120084455_500x500.webp"
    },
    {
        "name": "Sonu Nigam",
        "image": "https://c.saavncdn.com/artists/Sonu_Nigam_500x500.webp"
    },
    {
        "name": "Shreya Ghoshal",
        "image": "https://c.saavncdn.com/artists/Shreya_Ghoshal_007_20241101074144_500x500.webp"
    },
    {
        "name": "Kumar Sanu",
        "image": "https://c.saavncdn.com/artists/Kumar_Sanu_500x500.webp"
    },
    {
        "name": "Jubin Nautiyal",
        "image": "https://c.saavncdn.com/artists/Jubin_Nautiyal_003_20231130204020_500x500.webp"
    },
    {
        "name": "Neha Kakkar",
        "image": "https://c.saavncdn.com/artists/Neha_Kakkar_007_20241212115832_500x500.webp"
    },
    {
        "name": "Udit Narayan",
        "image": "https://c.saavncdn.com/artists/Udit_Narayan_004_20241029065120_500x500.webp"
    },
    {
        "name": "Lata Mangeshkar",
        "image": "https://c.saavncdn.com/artists/Lata_Mangeshkar_004_20230623105323_500x500.webp"
    },
    {
        "name": "KK",
        "image": "https://c.saavncdn.com/artists/KK_500x500.webp"
    },
    {
        "name": "Kishore Kumar",
        "image": "https://c.saavncdn.com/artists/Kishore_Kumar_500x500.webp"
    },
    {
        "name": "Asha Bhosle",
        "image": "https://c.saavncdn.com/artists/Asha_Bhosle_002_20200212082318_500x500.webp"
    },
    {
        "name": "Badshah",
        "image": "https://c.saavncdn.com/artists/Badshah_006_20241118064015_500x500.webp"
    },
    {
        "name": "Diljit Dosanjh",
        "image": "https://c.saavncdn.com/artists/Diljit_Dosanjh_005_20231025073054_500x500.webp"
    },
    {
        "name": "Armaan Malik",
        "image": "https://c.saavncdn.com/artists/Armaan_Malik_005_20240819091627_500x500.webp"
    },
    {
        "name": "Mohit Chauhan",
        "image": "https://c.saavncdn.com/artists/Mohit_Chauhan_500x500.webp"
    },
    {
        "name": "Vishal Dadlani",
        "image": "https://upload.wikimedia.org/wikipedia/commons/6/6f/Vishal_Dadlani_Indian_Idol_Junior_launch_%28cropped%29.jpg"
    },
    {
        "name": "Sunidhi Chauhan",
        "image": "https://c.saavncdn.com/artists/Sunidhi_Chauhan_005_20250515061617_500x500.webp"
    },
    {
        "name": "Darshan Raval",
        "image": "https://c.saavncdn.com/artists/Darshan_Raval_006_20250807060352_500x500.webp"
    },
    {
        "name": "Yo Yo Honey Singh",
        "image": "https://c.saavncdn.com/artists/Yo_Yo_Honey_Singh_002_20221216102650_500x500.webp"
    },
    {
        "name": "B Praak",
        "image": "https://upload.wikimedia.org/wikipedia/commons/6/67/National_Awards_B_Praak_%28cropped%29.jpg"
    },
    {
        "name": "Guru Randhawa",
        "image": "https://c.saavncdn.com/artists/Guru_Randhawa_500x500.jpg"
    },
    {
        "name": "Hardy Sandhu",
        "image": "https://c.saavncdn.com/artists/Hardy_Sandhu_500x500.jpg"
    },
    {
        "name": "Mika Singh",
        "image": "https://c.saavncdn.com/artists/Mika_Singh_500x500.jpg"
    },
    {
        "name": "Shaan",
        "image": "https://c.saavncdn.com/artists/Shaan_500x500.jpg"
    },
    {
        "name": "Kavita Krishnamurthy",
        "image": "https://c.saavncdn.com/artists/Kavita_Krishnamurthy_500x500.jpg"
    },
    {
        "name": "Alka Yagnik",
        "image": "https://c.saavncdn.com/artists/Alka_Yagnik_500x500.jpg"
    },
    {
        "name": "Sukhwinder Singh",
        "image": "https://c.saavncdn.com/artists/Sukhwinder_Singh_500x500.jpg"
    },
    {
        "name": "Kailash Kher",
        "image": "https://c.saavncdn.com/artists/Kailash_Kher_500x500.jpg"
    },
    {
        "name": "Shankar Mahadevan",
        "image": "https://c.saavncdn.com/artists/Shankar_Mahadevan_500x500.jpg"
    },
    {
        "name": "Amit Trivedi",
        "image": "https://c.saavncdn.com/artists/Amit_Trivedi_500x500.jpg"
    },
    {
        "name": "Palak Muchhal",
        "image": "https://c.saavncdn.com/artists/Palak_Muchhal_500x500.jpg"
    },
    {
        "name": "Neeti Mohan",
        "image": "https://c.saavncdn.com/artists/Neeti_Mohan_500x500.jpg"
    },
    {
        "name": "Monali Thakur",
        "image": "https://c.saavncdn.com/artists/Monali_Thakur_500x500.jpg"
    },
    {
        "name": "Kanika Kapoor",
        "image": "https://c.saavncdn.com/artists/Kanika_Kapoor_500x500.jpg"
    },
    {
        "name": "Amaal Mallik",
        "image": "https://c.saavncdn.com/artists/Amaal_Mallik_500x500.jpg"
    },
    {
        "name": "Rochak Kohli",
        "image": "https://upload.wikimedia.org/wikipedia/commons/a/aa/Rochak_Kohli.jpg"
    },
    {
        "name": "Tulsi Kumar",
        "image": "https://upload.wikimedia.org/wikipedia/commons/1/17/Tulsi_Kumar_in_Screen_Awards_2019_%285%29_%28cropped%29.jpg"
    },
    {
        "name": "Dhvani Bhanushali",
        "image": "https://upload.wikimedia.org/wikipedia/commons/7/76/Dhvani_Bhanushali_snapped_in_Khar_%28cropped%29.jpg"
    },
    {
        "name": "Javed Ali",
        "image": "https://c.saavncdn.com/artists/Javed_Ali_500x500.jpg"
    },
    {
        "name": "Papon",
        "image": "https://c.saavncdn.com/artists/Papon_500x500.jpg"
    },
    {
        "name": "Mithoon",
        "image": "https://c.saavncdn.com/artists/Mithoon_500x500.jpg"
    },
    {
        "name": "Ankit Tiwari",
        "image": "https://c.saavncdn.com/artists/Ankit_Tiwari_500x500.jpg"
    },
    {
        "name": "Sachin-Jigar",
        "image": "https://c.saavncdn.com/artists/Sachin-Jigar_500x500.jpg"
    },
    {
        "name": "Vishal-Shekhar",
        "image": "https://upload.wikimedia.org/wikipedia/commons/2/29/Vishal-Shekhar_in_2013.jpg"
    },
    {
        "name": "Meet Bros",
        "image": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Meet_bros_award.jpg/500px-Meet_bros_award.jpg"
    },
    {
        "name": "Tanishk Bagchi",
        "image": "https://upload.wikimedia.org/wikipedia/commons/1/19/Tanishk_Bagchi_graces_Dhvani_Bhanushali%27s_success_bash_of_Vaaste_%28cropped%29.jpg"
    },
    {
        "name": "Kunal Ganjawala",
        "image": "https://c.saavncdn.com/artists/Kunal_Ganjawala_500x500.jpg"
    },
    {
        "name": "Adnan Sami",
        "image": "https://c.saavncdn.com/artists/Adnan_Sami_500x500.jpg"
    },
    {
        "name": "Rahat Fateh Ali Khan",
        "image": "https://c.saavncdn.com/artists/Rahat_Fateh_Ali_Khan_500x500.jpg"
    },
    {
        "name": "K. S. Chithra",
        "image": "https://c.saavncdn.com/artists/K._S._Chithra_500x500.jpg"
    }
]


@app.route('/api/artists/top', methods=['GET'])
def top_artists():
    """Returns top Bollywood artists with hardcoded Wikipedia photos."""
    return jsonify({'success': True, 'artists': TOP_BOLLYWOOD_ARTISTS})


@app.route('/api/artist', methods=['GET'])
def artist_tracks():
    """Get 50 unique songs by artist — saavn.dev (BlackHole API) primary, fallbacks."""
    name = request.args.get('name', '').strip()
    if not name:
        return jsonify({'success': False, 'error': 'No artist name provided'})

    cache_key = f'artist:{name.lower()}'
    cached = get_cached_search(cache_key)
    if cached is not None:
        return jsonify({'success': True, 'artist': {'name': name}, 'tracks': cached})

    # ── Primary: JioSaavn Direct API ──
    all_songs = []
    seen_titles: set = set()
    try:
        resp = http_requests.get(
            f'https://www.jiosaavn.com/api.php?p=1&q={urllib.parse.quote(name)}&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=50&__call=search.getResults',
            headers=JIOSAAVN_HEADERS, timeout=8
        )
        data = resp.json()
        songs_raw = data.get('results', [])
        for song in songs_raw:
            song_id = song.get('id', '')
            title = clean_html(song.get('title', '') or song.get('song', '') or 'Unknown')
            t_key = title.lower().strip()
            if not song_id or t_key in seen_titles:
                continue
            
            artist = clean_html(song.get('more_info', {}).get('singers', '') or song.get('description', '') or 'Unknown')
            image = upgrade_image_url(song.get('image', ''))
            
            # Instantly decrypt URL for faster playback
            url = None
            enc = song.get('more_info', {}).get('encrypted_media_url', '')
            if enc:
                url = decrypt_jiosaavn_url(enc)
            
            seen_titles.add(t_key)
            all_songs.append({'id': song_id, 'title': title, 'artist': artist, 'image': image, 'url': url, 'source': 'jiosaavn'})
            
            if len(all_songs) >= 50:
                break
    except Exception as e:
        print(f"JioSaavn direct artist search error: {e}")

    # ── Last resort: YouTube ──
    if len(all_songs) < 5:
        seen_titles2: set = {s['title'].lower() for s in all_songs}
        for q in [f'{name} best songs', f'{name} top hits']:
            for song in youtube_search_songs(q, max_results=15):
                t_key = song.get('title', '').lower().strip()
                if t_key and t_key not in seen_titles2:
                    seen_titles2.add(t_key)
                    song['artist'] = name
                    all_songs.append(song)
                if len(all_songs) >= 50:
                    break

    if all_songs:
        set_cached_search(cache_key, all_songs)
    return jsonify({'success': True, 'artist': {'name': name}, 'tracks': all_songs})



@app.route('/ping', methods=['GET'])
def ping():
    """Keep-alive endpoint — frontend pings this every 4 min to prevent Render cold starts."""
    return jsonify({'ok': True})


@app.route('/api/stream', methods=['GET'])
def stream_audio():
    song_id    = request.args.get('id',     '').strip()
    title      = request.args.get('title',  '').strip()
    artist     = request.args.get('artist', '').strip()
    direct_url = request.args.get('url',    '').strip()   # ← fresh CDN URL from search results
    return_json = request.args.get('json', '') == 'true'
    if not song_id:
        return 'Missing song id', 400

    # ⚡ INSTANT PATH: frontend already has a fresh CDN URL — just redirect, no API calls needed
    if direct_url and direct_url.startswith('https://') and 'saavncdn' in direct_url:
        print(f'Instant CDN redirect (pre-resolved): {song_id}')
        if return_json:
            return jsonify({'url': direct_url})
        return redirect(direct_url, code=302)

    audio_url = ''
    source    = 'jiosaavn'

    # Songs sourced from YouTube search have a 'yt_' prefix — use Invidious first, yt-dlp fallback
    if song_id.startswith('yt_'):
        yt_id = song_id[3:]  # strip the 'yt_' prefix to get the real YouTube video ID
        print(f'Stream request for YouTube video ID: {yt_id}')

        # ── Primary: Invidious public proxy (fresh URL every time, no expiry issues) ──
        instance, itag = get_invidious_audio(yt_id)
        if instance and itag:
            proxy_url = f'{instance}/latest_version?id={yt_id}&itag={itag}&local=true'
            print(f'Redirecting to Invidious: {proxy_url}')
            if return_json:
                return jsonify({'url': proxy_url})
            return redirect(proxy_url, code=302)

        # ── Fallback: yt-dlp direct extraction ──
        cache_key = f'{title.lower().strip()}|{artist.lower().strip()}' if title else yt_id
        audio_url = get_cached_yt_url(cache_key)
        if not audio_url:
            try:
                import yt_dlp
                ydl_opts = {
                    'format': 'bestaudio[ext=m4a]/bestaudio[acodec=mp4a]/bestaudio/best',
                    'quiet': True,
                    'no_warnings': True,
                    'noplaylist': True,
                    'extract_flat': False,
                    'skip_download': True,
                    'socket_timeout': 20,
                }
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(f'https://www.youtube.com/watch?v={yt_id}', download=False)
                    if info:
                        formats = info.get('formats', [])
                        # Prefer m4a audio
                        m4a_audio = [f for f in formats if f.get('vcodec') == 'none' and f.get('ext') == 'm4a']
                        audio_only = [f for f in formats if f.get('vcodec') == 'none' and f.get('acodec') != 'none']
                        pool = m4a_audio or audio_only
                        if pool:
                            best = max(pool, key=lambda f: f.get('abr') or f.get('tbr') or 0)
                            audio_url = best.get('url', '')
                        if not audio_url:
                            audio_url = info.get('url', '')
                        if audio_url:
                            set_cached_yt_url(cache_key, audio_url)
            except Exception as e:
                print(f'yt-dlp extraction error: {e}')
        source = 'youtube'
    else:
        # 1️⃣ JioSaavn Direct Decryption
        audio_url = jiosaavn_get_audio_url(song_id)
        source    = 'jiosaavn'
        if audio_url:
            if return_json:
                return jsonify({'url': audio_url})
            return redirect(audio_url, code=302)

        # 4️⃣  Auto-fallback to YouTube if JioSaavn returned nothing
        if title:
            print(f'JioSaavn failed for {song_id} — trying YouTube fallback')
            audio_url = youtube_get_audio_url(title, artist)
            source    = 'youtube'

    if not audio_url:
        return 'Could not resolve audio URL from JioSaavn or YouTube', 404

    if return_json:
        if source == 'youtube':
            return jsonify({'url': f"{request.host_url.rstrip('/')}/api/stream?id={urllib.parse.quote(song_id)}"})
        return jsonify({'url': audio_url})

    # YouTube: must proxy (direct URL returns 403 from mobile clients)
    try:
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


# ─── Trending Charts ──────────────────────────────────────────────────────────

@app.route('/api/trending', methods=['GET'])
def get_trending():
    """Return top trending songs (uses a popular JioSaavn editorial playlist)."""
    try:
        # Use a high-quality JioSaavn playlist: Weekly Top Songs (id: 154133486 or similar)
        # We will use jiosaavn_search for "Weekly Top Songs" to get the first playlist, then get its songs.
        charts = []
        import urllib.request, urllib.parse
        search_url = f"https://www.jiosaavn.com/api.php?__call=search.getPlaylistResults&q={urllib.parse.quote('top jiosaavn')}&_format=json&_marker=0&ctx=android"
        sr = http_requests.get(search_url)
        sdata = sr.json()
        playlists = sdata.get('results', [])
        if playlists:
            pid = playlists[0].get('id')
            pl_url = f"https://www.jiosaavn.com/api.php?__call=playlist.getDetails&listid={pid}&_format=json&_marker=0&ctx=android"
            pr = http_requests.get(pl_url)
            pdata = pr.json()
            songs_raw = pdata.get('list', [])
            for song in songs_raw[:20]:
                sid = song.get('id', '')
                if not sid: continue
                title = clean_html(song.get('title', song.get('song', 'Unknown')))
                artist = clean_html(song.get('subtitle', song.get('singers', '')))
                image = song.get('image', '').replace('150x150', '500x500')
                url = _sd_best_url([{'url': song.get('media_preview_url', '')}]) if song.get('media_preview_url') else None
                if not url:
                    # try to decrypt if needed, or fallback to frontend fetching stream url
                    pass
                # Frontend fetchStreamUrl will handle the URL if it's missing, just send id
                charts.append({'id': sid, 'title': title, 'artist': artist, 'image': image, 'url': url, 'source': 'jiosaavn'})

        if not charts:
            charts = jiosaavn_search('latest bollywood hits')
        return jsonify({'success': True, 'songs': charts})
    except Exception as e:
        print(f'Trending error: {e}')
        # Always return something
        return jsonify({'success': True, 'songs': jiosaavn_search('latest bollywood hits')})


# ─── Lyrics ───────────────────────────────────────────────────────────────────

@app.route('/api/lyrics', methods=['GET'])
def get_lyrics():
    """Fetch lyrics from lyrics.ovh (free, no API key needed)."""
    title  = request.args.get('title',  '').strip()
    artist = request.args.get('artist', '').strip()
    if not title or not artist:
        return jsonify({'success': False, 'error': 'title and artist required'})
    try:
        # Clean title (remove feat., remix, etc for better match)
        clean_title  = re.sub(r'\s*\(.*?\)', '', title).strip()
        clean_artist = artist.split(',')[0].strip()  # use primary artist only
        r = http_requests.get(
            f'https://api.lyrics.ovh/v1/{clean_artist}/{clean_title}',
            timeout=8,
        )
        if r.status_code == 200:
            data = r.json()
            lyrics = data.get('lyrics', '')
            if lyrics:
                return jsonify({'success': True, 'lyrics': lyrics.strip()})
        # Fallback: try with original title
        r2 = http_requests.get(f'https://api.lyrics.ovh/v1/{artist}/{title}', timeout=8)
        if r2.status_code == 200:
            data2 = r2.json()
            lyrics2 = data2.get('lyrics', '')
            if lyrics2:
                return jsonify({'success': True, 'lyrics': lyrics2.strip()})
        return jsonify({'success': False, 'error': 'Lyrics not found'})
    except Exception as e:
        print(f'Lyrics error: {e}')
        return jsonify({'success': False, 'error': str(e)})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
