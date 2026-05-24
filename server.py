from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import requests
import random
import time
import os
import re
import html
from base64 import b64decode

app = Flask(__name__)
CORS(app)

# ─── In-memory cache ──────────────────────────────────────────────────────────
SEARCH_CACHE_TTL = 300   # 5 Minutes
URL_CACHE_TTL    = 780   # 13 Minutes

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

# ─── JioSaavn DES Decryption ──────────────────────────────────────────────────

def decrypt_jiosaavn_url(encrypted_url: str) -> str:
    """
    JioSaavn encodes the audio URL with DES ECB + base64.
    Key is fixed: '38346591' (JioSaavn's known key).
    """
    try:
        from Crypto.Cipher import DES
        key = b"38346591"
        enc = b64decode(encrypted_url.strip())
        cipher = DES.new(key, DES.MODE_ECB)
        decrypted = cipher.decrypt(enc)
        # Remove PKCS5 padding
        pad_len = decrypted[-1]
        if isinstance(pad_len, int) and 1 <= pad_len <= 8:
            decrypted = decrypted[:-pad_len]
        url = decrypted.decode('utf-8', errors='ignore').strip()
        # Upgrade to 320kbps if available
        url = url.replace('_96.mp4', '_320.mp4').replace('_160.mp4', '_320.mp4')
        return url
    except Exception as e:
        print(f"DES decryption error: {e}")
        return ""

def clean_html(text: str) -> str:
    """Remove HTML entities and tags from JioSaavn titles."""
    text = html.unescape(text)
    text = re.sub(r'<[^>]+>', '', text)
    return text.strip()

# ─── JioSaavn API Helpers ─────────────────────────────────────────────────────

JIOSAAVN_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json"
}

def jiosaavn_search(query: str):
    """Search JioSaavn and return top results."""
    try:
        url = "https://www.jiosaavn.com/api.php"
        params = {
            "__call": "autocomplete.get",
            "query": query,
            "_format": "json",
            "_marker": "0",
            "ctx": "android"
        }
        resp = requests.get(url, params=params, headers=JIOSAAVN_HEADERS, timeout=10)
        data = resp.json()

        songs_raw = data.get("songs", {}).get("data", [])
        results = []
        for song in songs_raw[:10]:
            song_id = song.get("id", "")
            title   = clean_html(song.get("title", "Unknown"))
            artist  = clean_html(song.get("more_info", {}).get("singers", song.get("description", "Unknown")))
            image   = song.get("image", "").replace("150x150", "500x500")

            results.append({
                "id":     song_id,
                "title":  title,
                "artist": artist,
                "image":  image,
                "url":    None   # Fetched on-demand via /api/stream
            })
        return results
    except Exception as e:
        print(f"JioSaavn search error: {e}")
        return []


def jiosaavn_get_audio_url(song_id: str) -> str:
    """Fetch and decrypt the playable audio URL for a given JioSaavn song ID."""
    cached = get_cached_url(song_id)
    if cached:
        return cached

    try:
        url = "https://www.jiosaavn.com/api.php"
        params = {
            "__call":      "song.getDetails",
            "cc":          "in",
            "_bit_rate":   "320",
            "_format":     "json",
            "pids":        song_id,
            "ctx":         "android",
            "_marker":     "0"
        }
        resp = requests.get(url, params=params, headers=JIOSAAVN_HEADERS, timeout=10)
        data = resp.json()

        # Response is a dict keyed by song_id
        song_data = data.get(song_id, {})
        encrypted = song_data.get("encrypted_media_url", "")

        if not encrypted:
            # Fallback: try media_url directly
            direct = song_data.get("media_url", "")
            if direct:
                set_cached_url(song_id, direct)
                return direct
            return ""

        audio_url = decrypt_jiosaavn_url(encrypted)
        if audio_url:
            set_cached_url(song_id, audio_url)
        return audio_url

    except Exception as e:
        print(f"JioSaavn URL fetch error: {e}")
        return ""

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route('/api/search', methods=['GET'])
def search():
    query = request.args.get('query', '').strip()
    if not query:
        return jsonify({"success": False, "error": "No query provided"})

    cached = get_cached_search(query)
    if cached is not None:
        return jsonify({"success": True, "data": {"results": cached}})

    try:
        songs = jiosaavn_search(query)
        set_cached_search(query, songs)
        return jsonify({"success": True, "data": {"results": songs}})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/api/random', methods=['GET'])
def random_song():
    genres = ["Arijit Singh hits", "Trending Bollywood 2024", "AR Rahman best songs"]
    query = random.choice(genres)

    cached = get_cached_search(query)
    if cached:
        return jsonify({"success": True, "data": {"song": random.choice(cached)}})

    try:
        songs = jiosaavn_search(query)
        if not songs:
            return jsonify({"success": False, "error": "No tracks found"})
        set_cached_search(query, songs)
        return jsonify({"success": True, "data": {"song": random.choice(songs)}})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/api/stream', methods=['GET'])
def stream_audio():
    """Fetches, decrypts, and proxies JioSaavn audio chunk-by-chunk."""
    song_id = request.args.get('id', '').strip()
    if not song_id:
        return "Missing song id", 400

    audio_url = jiosaavn_get_audio_url(song_id)
    if not audio_url:
        return "Could not resolve audio URL", 404

    try:
        req = requests.get(audio_url, stream=True, headers={
            "User-Agent": "Mozilla/5.0",
            "Range": request.headers.get("Range", "bytes=0-")
        }, timeout=15)

        def generate():
            for chunk in req.iter_content(chunk_size=32768):
                if chunk:
                    yield chunk

        status_code = req.status_code
        content_type = req.headers.get("Content-Type", "audio/mpeg")
        headers = {
            "Content-Type": content_type,
            "Accept-Ranges": "bytes",
        }
        if "Content-Range" in req.headers:
            headers["Content-Range"] = req.headers["Content-Range"]
        if "Content-Length" in req.headers:
            headers["Content-Length"] = req.headers["Content-Length"]

        return Response(generate(), status=status_code, headers=headers)

    except Exception as e:
        return f"Streaming error: {str(e)}", 500


@app.route('/api/refresh', methods=['GET'])
def refresh_url():
    """Returns the proxy stream URL for a given song ID (used by the app)."""
    song_id = request.args.get('id', '').strip()
    if not song_id:
        return jsonify({"success": False, "error": "No id provided"})

    # Bust the cache so we get a fresh URL
    url_cache.pop(song_id, None)
    proxy_url = f"{request.host_url}api/stream?id={song_id}"
    return jsonify({"success": True, "data": {"url": proxy_url}})


@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "backend": "JioSaavn"})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)