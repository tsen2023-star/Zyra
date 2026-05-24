"""
Zyra Backend — Flask server with:
  • JioSaavn music search + streaming
  • JWT Email/Password authentication
  • Per-user MongoDB data (favorites, playlists, history, downloads)
  • Smart mood-based autoplay recommendations
"""

from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import requests as http_requests
import random, time, os, re, html, jwt, hashlib
from base64 import b64decode
from datetime import datetime, timedelta
from bson import ObjectId
from pymongo import MongoClient
from recommender import (
    detect_mood, get_query_for_mood, get_time_of_day_mood,
    build_recommendation_reason, MOOD_LABELS
)

app = Flask(__name__)
CORS(app)

# ─── Config ───────────────────────────────────────────────────────────────────

MONGO_URI  = os.environ.get('MONGO_URI',  'mongodb+srv://Bablu-Zyra:Bablu2006@zyra.sivio8f.mongodb.net/zyra?appName=Zyra')
JWT_SECRET = os.environ.get('JWT_SECRET', 'zyra-super-secret-2025')
JWT_EXPIRY_DAYS = 30

# ─── MongoDB ──────────────────────────────────────────────────────────────────

mongo  = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
db     = mongo['zyra']
users  = db['users']

# ─── In-memory cache ──────────────────────────────────────────────────────────

SEARCH_CACHE_TTL = 300
URL_CACHE_TTL    = 780
search_cache = {}
url_cache    = {}

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

# ─── JWT Helpers ──────────────────────────────────────────────────────────────

# ─── Password Hashing (built-in hashlib — no C extensions needed) ────────────

def hash_password(password: str) -> str:
    salt = os.urandom(32)
    key  = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
    return (salt + key).hex()

def verify_password(stored_hex: str, provided: str) -> bool:
    try:
        stored = bytes.fromhex(stored_hex)
        salt   = stored[:32]
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
    token = auth[7:]
    user_id = verify_token(token)
    if not user_id:
        return None
    try:
        user = users.find_one({'_id': ObjectId(user_id)})
        return user
    except Exception:
        return None

def user_required(f):
    """Decorator to protect routes that need a logged-in user."""
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        user = get_user_from_request()
        if not user:
            return jsonify({'success': False, 'error': 'Unauthorized'}), 401
        return f(user, *args, **kwargs)
    return decorated

def serialize_user(user):
    return {
        'id':       str(user['_id']),
        'username': user.get('username', ''),
        'email':    user.get('email', ''),
    }

# ─── JioSaavn Helpers ─────────────────────────────────────────────────────────

JIOSAAVN_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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

def jiosaavn_search(query: str):
    try:
        resp = http_requests.get(
            'https://www.jiosaavn.com/api.php',
            params={'__call': 'autocomplete.get', 'query': query,
                    '_format': 'json', '_marker': '0', 'ctx': 'android'},
            headers=JIOSAAVN_HEADERS, timeout=10
        )
        data = resp.json()
        songs_raw = data.get('songs', {}).get('data', [])
        results = []
        for song in songs_raw[:10]:
            song_id = song.get('id', '')
            title   = clean_html(song.get('title', 'Unknown'))
            artist  = clean_html(song.get('more_info', {}).get('singers', song.get('description', 'Unknown')))
            image   = song.get('image', '').replace('150x150', '500x500')
            results.append({'id': song_id, 'title': title, 'artist': artist, 'image': image, 'url': None})
        return results
    except Exception as e:
        print(f'JioSaavn search error: {e}')
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

@app.route('/api/test-db', methods=['GET'])
def test_db():
    """Diagnostic route — tests MongoDB connectivity."""
    try:
        mongo.admin.command('ping')
        count = users.count_documents({})
        return jsonify({'success': True, 'message': 'MongoDB connected!', 'user_count': count})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ─── Auth Routes ──────────────────────────────────────────────────────────────

@app.route('/api/auth/register', methods=['POST'])
def register():
    try:
        data = request.get_json() or {}
        email    = data.get('email', '').strip().lower()
        password = data.get('password', '').strip()
        username = data.get('username', '').strip() or email.split('@')[0]

        if not email or not password:
            return jsonify({'success': False, 'error': 'Email and password required'})
        if len(password) < 6:
            return jsonify({'success': False, 'error': 'Password must be at least 6 characters'})
        if users.find_one({'email': email}):
            return jsonify({'success': False, 'error': 'Email already registered'})

        hashed = hash_password(password)
        result = users.insert_one({
            'email':         email,
            'password_hash': hashed,
            'username':      username,
            'created_at':    datetime.utcnow(),
            'favorites':     [],
            'playlists':     [],
            'history':       [],
            'downloads':     [],
            'settings':      {'shake_enabled': False, 'smart_autoplay': True},
        })
        user_id = str(result.inserted_id)
        token   = create_token(user_id)
        return jsonify({'success': True, 'token': token, 'userId': user_id, 'username': username})
    except Exception as e:
        print(f'Register error: {e}')
        return jsonify({'success': False, 'error': f'Server error: {str(e)}'}), 500


@app.route('/api/auth/login', methods=['POST'])
def login():
    try:
        data = request.get_json() or {}
        email    = data.get('email', '').strip().lower()
        password = data.get('password', '').strip()

        if not email or not password:
            return jsonify({'success': False, 'error': 'Email and password required'})

        user = users.find_one({'email': email})
        if not user:
            return jsonify({'success': False, 'error': 'Invalid email or password'})

        if not verify_password(user['password_hash'], password):
            return jsonify({'success': False, 'error': 'Invalid email or password'})

        user_id = str(user['_id'])
        token   = create_token(user_id)
        return jsonify({'success': True, 'token': token, 'userId': user_id, 'username': user.get('username', '')})
    except Exception as e:
        print(f'Login error: {e}')
        return jsonify({'success': False, 'error': f'Server error: {str(e)}'}), 500

# ─── User Data Routes ─────────────────────────────────────────────────────────

@app.route('/api/user/profile', methods=['GET'])
@user_required
def get_profile(user):
    return jsonify({'success': True, 'data': {
        **serialize_user(user),
        'settings': user.get('settings', {}),
    }})


@app.route('/api/user/favorites', methods=['GET'])
@user_required
def get_favorites(user):
    return jsonify({'success': True, 'data': {'favorites': user.get('favorites', [])}})


@app.route('/api/user/favorites', methods=['POST'])
@user_required
def toggle_favorite(user):
    song = request.get_json() or {}
    song_id = song.get('id', '')
    if not song_id:
        return jsonify({'success': False, 'error': 'No song id'})

    uid   = user['_id']
    favs  = user.get('favorites', [])
    exists = next((f for f in favs if f['id'] == song_id), None)

    if exists:
        users.update_one({'_id': uid}, {'$pull': {'favorites': {'id': song_id}}})
        action = 'removed'
    else:
        entry = {k: song.get(k, '') for k in ['id', 'title', 'artist', 'image']}
        users.update_one({'_id': uid}, {'$push': {'favorites': entry}})
        action = 'added'

    updated = users.find_one({'_id': uid})
    return jsonify({'success': True, 'action': action, 'data': {'favorites': updated.get('favorites', [])}})


@app.route('/api/user/playlists', methods=['GET'])
@user_required
def get_playlists(user):
    return jsonify({'success': True, 'data': {'playlists': user.get('playlists', [])}})


@app.route('/api/user/playlists', methods=['POST'])
@user_required
def create_playlist(user):
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    song = data.get('song', None)
    if not name:
        return jsonify({'success': False, 'error': 'Playlist name required'})

    playlist = {
        'id':   str(ObjectId()),
        'name': name,
        'songs': [song] if song else [],
    }
    users.update_one({'_id': user['_id']}, {'$push': {'playlists': playlist}})
    updated = users.find_one({'_id': user['_id']})
    return jsonify({'success': True, 'data': {'playlists': updated.get('playlists', [])}})


@app.route('/api/user/playlists/<playlist_id>/songs', methods=['POST'])
@user_required
def add_to_playlist(user, playlist_id):
    song = request.get_json() or {}
    song_id = song.get('id', '')
    if not song_id:
        return jsonify({'success': False, 'error': 'No song id'})

    uid = user['_id']
    playlists = user.get('playlists', [])
    pl = next((p for p in playlists if p['id'] == playlist_id), None)
    if not pl:
        return jsonify({'success': False, 'error': 'Playlist not found'})

    # Avoid duplicates
    if any(s['id'] == song_id for s in pl.get('songs', [])):
        return jsonify({'success': True, 'message': 'Already in playlist'})

    users.update_one(
        {'_id': uid, 'playlists.id': playlist_id},
        {'$push': {'playlists.$.songs': {k: song.get(k, '') for k in ['id', 'title', 'artist', 'image']}}}
    )
    updated = users.find_one({'_id': uid})
    return jsonify({'success': True, 'data': {'playlists': updated.get('playlists', [])}})


@app.route('/api/user/history', methods=['GET'])
@user_required
def get_history(user):
    history = user.get('history', [])
    return jsonify({'success': True, 'data': {'history': history[-50:][::-1]}})


@app.route('/api/user/history', methods=['POST'])
@user_required
def add_history(user):
    song = request.get_json() or {}
    song_id = song.get('id', '')
    if not song_id:
        return jsonify({'success': False, 'error': 'No song id'})

    mood = detect_mood(song.get('title', ''), song.get('artist', ''))
    entry = {
        'id':        song_id,
        'title':     song.get('title', ''),
        'artist':    song.get('artist', ''),
        'image':     song.get('image', ''),
        'mood':      mood,
        'played_at': datetime.utcnow().isoformat(),
    }

    uid = user['_id']
    # Keep last 100 history entries
    users.update_one({'_id': uid}, {'$push': {
        'history': {'$each': [entry], '$slice': -100}
    }})
    return jsonify({'success': True, 'mood': mood, 'mood_label': MOOD_LABELS.get(mood, '')})


@app.route('/api/user/downloads', methods=['GET'])
@user_required
def get_downloads(user):
    return jsonify({'success': True, 'data': {'downloads': user.get('downloads', [])}})


@app.route('/api/user/downloads', methods=['POST'])
@user_required
def save_download(user):
    song = request.get_json() or {}
    song_id = song.get('id', '')
    if not song_id:
        return jsonify({'success': False, 'error': 'No song id'})

    entry = {k: song.get(k, '') for k in ['id', 'title', 'artist', 'image', 'localUri']}
    uid = user['_id']
    downloads = user.get('downloads', [])
    if not any(d['id'] == song_id for d in downloads):
        users.update_one({'_id': uid}, {'$push': {'downloads': entry}})
    updated = users.find_one({'_id': uid})
    return jsonify({'success': True, 'data': {'downloads': updated.get('downloads', [])}})


@app.route('/api/user/settings', methods=['POST'])
@user_required
def update_settings(user):
    data = request.get_json() or {}
    uid = user['_id']
    updates = {}
    if 'shake_enabled' in data:
        updates['settings.shake_enabled'] = bool(data['shake_enabled'])
    if 'smart_autoplay' in data:
        updates['settings.smart_autoplay'] = bool(data['smart_autoplay'])
    if updates:
        users.update_one({'_id': uid}, {'$set': updates})
    updated = users.find_one({'_id': uid})
    return jsonify({'success': True, 'data': {'settings': updated.get('settings', {})}})

# ─── Recommendation / Autoplay Route ─────────────────────────────────────────

@app.route('/api/autoplay', methods=['GET'])
def autoplay():
    """
    Smart autoplay: returns the next recommended song based on mood.
    Optional: userId for personalised history-based recommendations.
    """
    song_id  = request.args.get('songId', '').strip()
    user_id  = request.args.get('userId', '').strip()
    mood_override = request.args.get('mood', '').strip()

    exclude_ids = set()
    user_mood   = mood_override or None
    is_time_based = False

    # Enrich with user data if logged in
    if user_id:
        try:
            user = users.find_one({'_id': ObjectId(user_id)})
            if user:
                history = user.get('history', [])
                # Collect played IDs to exclude
                exclude_ids = {h['id'] for h in history[-20:]}
                # Detect user's recent dominant mood
                if not user_mood and history:
                    recent_moods = [h.get('mood', 'default') for h in history[-10:]]
                    user_mood = max(set(recent_moods), key=recent_moods.count)
        except Exception:
            pass

    # Detect mood of current song if available
    if not user_mood and song_id:
        # Try to get song title from JioSaavn
        try:
            resp = http_requests.get(
                'https://www.jiosaavn.com/api.php',
                params={'__call': 'song.getDetails', 'cc': 'in',
                        '_format': 'json', 'pids': song_id, 'ctx': 'android', '_marker': '0'},
                headers=JIOSAAVN_HEADERS, timeout=6
            )
            data = resp.json()
            song_data = data.get(song_id, {})
            title  = clean_html(song_data.get('song', ''))
            artist = clean_html(song_data.get('primary_artists', ''))
            if title:
                user_mood = detect_mood(title, artist)
        except Exception:
            pass

    # Fall back to time-of-day mood
    if not user_mood or user_mood == 'default':
        user_mood = get_time_of_day_mood()
        is_time_based = True

    # Search JioSaavn for songs matching the mood
    query   = get_query_for_mood(user_mood)
    results = get_cached_search(query)
    if not results:
        results = jiosaavn_search(query)
        if results:
            set_cached_search(query, results)

    # Filter out recently played songs
    filtered = [s for s in results if s['id'] not in exclude_ids]
    if not filtered:
        filtered = results  # If all excluded, play anyway

    if not filtered:
        return jsonify({'success': False, 'error': 'No recommendations found'})

    song   = random.choice(filtered)
    reason = build_recommendation_reason(user_mood, is_time_based)

    return jsonify({
        'success': True,
        'song':    song,
        'mood':    user_mood,
        'mood_label': MOOD_LABELS.get(user_mood, ''),
        'reason':  reason,
    })


@app.route('/api/recommendations/queue', methods=['GET'])
def recommendations_queue():
    """Returns 3 upcoming recommended songs for the queue display."""
    song_id = request.args.get('songId', '').strip()
    user_id = request.args.get('userId', '').strip()
    mood    = request.args.get('mood', '').strip() or get_time_of_day_mood()

    exclude_ids = {song_id} if song_id else set()

    query   = get_query_for_mood(mood)
    results = get_cached_search(query)
    if not results:
        results = jiosaavn_search(query)
        if results:
            set_cached_search(query, results)

    filtered = [s for s in results if s['id'] not in exclude_ids]
    queue    = random.sample(filtered, min(3, len(filtered)))
    return jsonify({'success': True, 'queue': queue, 'mood': mood})

# ─── JioSaavn Music Routes ────────────────────────────────────────────────────

@app.route('/api/search', methods=['GET'])
def search():
    query = request.args.get('query', '').strip()
    if not query:
        return jsonify({'success': False, 'error': 'No query provided'})
    cached = get_cached_search(query)
    if cached is not None:
        return jsonify({'success': True, 'data': {'results': cached}})
    try:
        songs = jiosaavn_search(query)
        set_cached_search(query, songs)
        return jsonify({'success': True, 'data': {'results': songs}})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/random', methods=['GET'])
def random_song():
    genres = ['Arijit Singh hits', 'Trending Bollywood 2024', 'AR Rahman best songs']
    query  = random.choice(genres)
    cached = get_cached_search(query)
    if cached:
        return jsonify({'success': True, 'data': {'song': random.choice(cached)}})
    try:
        songs = jiosaavn_search(query)
        if not songs:
            return jsonify({'success': False, 'error': 'No tracks found'})
        set_cached_search(query, songs)
        return jsonify({'success': True, 'data': {'song': random.choice(songs)}})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/stream', methods=['GET'])
def stream_audio():
    song_id = request.args.get('id', '').strip()
    if not song_id:
        return 'Missing song id', 400
    audio_url = jiosaavn_get_audio_url(song_id)
    if not audio_url:
        return 'Could not resolve audio URL', 404
    try:
        req = http_requests.get(audio_url, stream=True, headers={
            'User-Agent': 'Mozilla/5.0',
            'Range': request.headers.get('Range', 'bytes=0-'),
        }, timeout=15)

        def generate():
            for chunk in req.iter_content(chunk_size=32768):
                if chunk:
                    yield chunk

        headers = {'Content-Type': req.headers.get('Content-Type', 'audio/mpeg'), 'Accept-Ranges': 'bytes'}
        if 'Content-Range'  in req.headers: headers['Content-Range']  = req.headers['Content-Range']
        if 'Content-Length' in req.headers: headers['Content-Length'] = req.headers['Content-Length']
        return Response(generate(), status=req.status_code, headers=headers)
    except Exception as e:
        return f'Streaming error: {str(e)}', 500


@app.route('/api/refresh', methods=['GET'])
def refresh_url():
    song_id = request.args.get('id', '').strip()
    if not song_id:
        return jsonify({'success': False, 'error': 'No id provided'})
    url_cache.pop(song_id, None)
    proxy_url = f"{request.host_url}api/stream?id={song_id}"
    return jsonify({'success': True, 'data': {'url': proxy_url}})


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'backend': 'JioSaavn + MongoDB'})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)