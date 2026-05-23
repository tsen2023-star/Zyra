from flask import Flask, request, jsonify
from flask_cors import CORS
import yt_dlp
import random
import time
import os

app = Flask(__name__)
CORS(app)

# ─── In-memory cache ────────────────────────────────────────────────────────
SEARCH_CACHE_TTL = 600    # 10 minutes
URL_CACHE_TTL    = 10800  # 3 hours (YouTube URLs last ~6 hours)

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

def get_cached_url(video_id):
    item = url_cache.get(video_id)
    if item and time.time() - item['ts'] < URL_CACHE_TTL:
        return item['url']
    url_cache.pop(video_id, None)
    return None

def set_cached_url(video_id, url):
    url_cache[video_id] = {'ts': time.time(), 'url': url}

# ─── Shared yt-dlp options ───────────────────────────────────────────────────
SEARCH_OPTS = {
    'format': 'bestaudio/best',
    'noplaylist': True,
    'quiet': True,
    'extract_flat': True,
    'no_warnings': True,
}

REFRESH_OPTS = {
    # Use Android client — bypasses YouTube's datacenter IP restrictions
    'format': 'bestaudio[ext=m4a]/bestaudio/best',
    'noplaylist': True,
    'quiet': True,
    'skip_download': True,
    'no_warnings': True,
    'no_check_certificate': True,
    'extractor_args': {
        'youtube': {
            'player_client': ['android'],
            'player_skip': ['webpage', 'configs'],
        }
    },
}

# ─── Routes ──────────────────────────────────────────────────────────────────

@app.route('/api/search', methods=['GET'])
def search():
    query = request.args.get('query', '').strip()
    if not query:
        return jsonify({"success": False, "error": "No query provided"})

    cached = get_cached_search(query)
    if cached is not None:
        return jsonify({"success": True, "data": {"results": cached}})

    try:
        with yt_dlp.YoutubeDL(SEARCH_OPTS) as ydl:
            info = ydl.extract_info(f"ytsearch3:{query}", download=False)
            songs = [
                {
                    'id':     e['id'],
                    'title':  e.get('title', 'Unknown Title'),
                    'artist': e.get('uploader', e.get('channel', 'Unknown Artist')),
                    'url':    None,
                }
                for e in info.get('entries', [])
            ]
        set_cached_search(query, songs)
        return jsonify({"success": True, "data": {"results": songs}})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/api/random', methods=['GET'])
def random_song():
    genres = [
        "trending pop hit", "lofi chill beats", "global top 50",
        "acoustic cover", "synthwave retrowave", "jazz classics"
    ]
    query = random.choice(genres)

    # Return instantly from cache if available
    cached = get_cached_search(query)
    if cached:
        return jsonify({"success": True, "data": {"song": random.choice(cached)}})

    try:
        with yt_dlp.YoutubeDL(SEARCH_OPTS) as ydl:
            info = ydl.extract_info(f"ytsearch5:{query}", download=False)
            entries = info.get('entries', [])
            if not entries:
                return jsonify({"success": False, "error": "No tracks found"})

            songs = [
                {
                    'id':     e['id'],
                    'title':  e.get('title', 'Unknown Title'),
                    'artist': e.get('uploader', e.get('channel', 'Unknown Artist')),
                    'url':    None,
                }
                for e in entries
            ]
        set_cached_search(query, songs)
        return jsonify({"success": True, "data": {"song": random.choice(songs)}})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


import urllib.request
import json

INVIDIOUS_INSTANCES = [
    "https://vid.puffyan.us",
    "https://inv.tux.pizza",
    "https://invidious.asir.dev",
    "https://inv.nadeko.net"
]

def get_stream_url_from_proxy(video_id):
    for instance in INVIDIOUS_INSTANCES:
        try:
            req = urllib.request.Request(
                f"{instance}/api/v1/videos/{video_id}",
                headers={"User-Agent": "Mozilla/5.0"}
            )
            with urllib.request.urlopen(req, timeout=5) as response:
                data = json.loads(response.read().decode())
                
                # Look for adaptiveFormats (contains audio-only streams)
                formats = data.get('adaptiveFormats', []) + data.get('formatStreams', [])
                audio_streams = [f for f in formats if f.get('type', '').startswith('audio')]
                
                if audio_streams:
                    # Sort by bitrate descending
                    audio_streams.sort(key=lambda x: int(x.get('bitrate', 0)), reverse=True)
                    return audio_streams[0]['url']
        except Exception:
            continue
    return None

@app.route('/api/refresh', methods=['GET'])
def refresh_url():
    video_id = request.args.get('id', '').strip()
    if not video_id:
        return jsonify({"success": False, "error": "No id provided"})

    cached = get_cached_url(video_id)
    if cached:
        return jsonify({"success": True, "data": {"url": cached}})

    # First try using Invidious API to bypass IP blocks
    url = get_stream_url_from_proxy(video_id)
    
    # Fallback to yt-dlp if proxy fails
    if not url:
        try:
            with yt_dlp.YoutubeDL(REFRESH_OPTS) as ydl:
                entry = ydl.extract_info(video_id, download=False)
                url = entry.get('url')
        except Exception as e:
            return jsonify({"success": False, "error": f"Failed to resolve stream: {str(e)}"})

    if url:
        set_cached_url(video_id, url)
        return jsonify({"success": True, "data": {"url": url}})
    else:
        return jsonify({"success": False, "error": "No audio stream found"})


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == '__main__':
    # Render / Railway inject PORT via environment variable
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
