"""
recommender.py — Zyra Smart Mood-Based Recommendation Engine
"""
import random
from datetime import datetime

# ─── Mood Keyword Detection ───────────────────────────────────────────────────

MOOD_KEYWORDS = {
    "romantic": [
        "ishq", "pyaar", "mohabbat", "love", "dil", "romantic", "dilbar",
        "sajna", "jaanu", "tere bina", "tera", "meri", "tum hi ho", "teri",
        "pehla nasha", "dilwale", "raj", "simran", "qayamat", "main teri"
    ],
    "sad": [
        "sad", "dard", "tanha", "judai", "alvida", "rootha", "rona", "aansu",
        "baarish", "bewafa", "intezaar", "khoya", "akela", "bichhad", "yaad",
        "dhua", "kho gaye", "chori", "toot", "bichad"
    ],
    "item": [
        "item", "baby", "sheila", "munni", "chikni", "chameli", "fevicol",
        "dj", "party", "nagin", "hook", "beat", "desi beat", "lungi",
        "kamli", "halkat", "laila", "jumme"
    ],
    "90s": [
        "kumar sanu", "udit narayan", "alka yagnik", "asha bhosle",
        "lata mangeshkar", "sonu nigam 90", "90s", "retro", "purana",
        "classic", "hum aapke", "dilwale dulhania", "baazigar", "kuch kuch"
    ],
    "bhajan": [
        "bhajan", "aarti", "om", "shri", "jai", "mata", "ram", "krishna",
        "hanuman", "ganesh", "durga", "mantra", "chalisa", "shiva", "vishnu",
        "devotional", "pooja", "kirtan", "bhakti", "sankirtan", "raghupati"
    ],
    "energetic": [
        "workout", "gym", "power", "bhangra", "garba", "dandiya",
        "dhol", "rock", "pumping", "high energy", "navratri", "dance",
        "upbeat", "peppy", "fast", "cardio"
    ],
}

# JioSaavn search queries per mood
MOOD_QUERIES = {
    "romantic": [
        "romantic hindi songs 2024",
        "arijit singh love songs",
        "best bollywood love songs",
        "tum hi ho romantic",
        "pyaar songs hindi",
    ],
    "sad": [
        "sad hindi songs 2024",
        "heartbreak bollywood songs",
        "dard bhari songs hindi",
        "emotional hindi songs arijit",
        "bewafa songs hindi",
    ],
    "item": [
        "item songs bollywood 2024",
        "party dance songs hindi",
        "peppy bollywood songs",
        "item number hindi",
        "best dance songs india",
    ],
    "90s": [
        "90s bollywood hits",
        "kumar sanu best songs",
        "udit narayan hit songs",
        "retro bollywood classics",
        "alka yagnik hit songs",
    ],
    "bhajan": [
        "top bhajans 2024",
        "devotional songs hindi",
        "hanuman chalisa songs",
        "krishna bhajan best",
        "mata ki aarti bhajan",
    ],
    "energetic": [
        "gym workout hindi songs",
        "bhangra hits punjabi",
        "upbeat bollywood 2024",
        "navratri garba songs",
        "high energy hindi songs",
    ],
    "default": [
        "trending bollywood 2024",
        "top hindi songs this week",
        "arijit singh best songs",
        "latest hindi hits",
    ],
}

# Mood display labels for the UI
MOOD_LABELS = {
    "romantic": "Romantic ❤️",
    "sad":      "Sad 😢",
    "item":     "Party 🎉",
    "90s":      "Retro 🎶",
    "bhajan":   "Devotional 🙏",
    "energetic":"Energetic ⚡",
    "default":  "Trending 🔥",
}

# Autoplay reason strings
MOOD_REASONS = {
    "romantic": "Because you love Romantic songs ❤️",
    "sad":      "Continuing your sad mood 😢",
    "item":     "Keeping the party going 🎉",
    "90s":      "Your 90s nostalgia trip 🎶",
    "bhajan":   "Continuing your devotional session 🙏",
    "energetic":"Keeping your energy up ⚡",
    "default":  "Trending picks for you 🔥",
}


def detect_mood(title: str, artist: str) -> str:
    """Detect the mood/genre of a song from its title and artist name."""
    text = (title + " " + artist).lower()

    scores = {mood: 0 for mood in MOOD_KEYWORDS}
    for mood, keywords in MOOD_KEYWORDS.items():
        for keyword in keywords:
            if keyword in text:
                scores[mood] += 1

    best_mood = max(scores, key=scores.get)
    if scores[best_mood] == 0:
        return "default"
    return best_mood


def get_time_of_day_mood() -> str:
    """Returns a mood suggestion based on the current time of day (IST)."""
    hour = datetime.utcnow().hour + 5  # Approximate IST offset
    hour = hour % 24

    if 6 <= hour < 12:
        return "energetic"   # Morning — high energy
    elif 12 <= hour < 18:
        return "default"     # Afternoon — mixed
    elif 18 <= hour < 22:
        return "romantic"    # Evening — romantic
    else:
        return "sad"         # Late night — sad/chill


def get_query_for_mood(mood: str) -> str:
    """Returns a random JioSaavn search query for the given mood."""
    queries = MOOD_QUERIES.get(mood, MOOD_QUERIES["default"])
    return random.choice(queries)


def build_recommendation_reason(mood: str, is_time_based: bool = False) -> str:
    """Returns a human-friendly reason string for the UI."""
    if is_time_based:
        hour = (datetime.utcnow().hour + 5) % 24
        if hour < 12:
            return "Good morning! Starting with energy ⚡"
        elif hour < 18:
            return "Afternoon mix for you 🎵"
        elif hour < 22:
            return "Perfect evening vibes 🌆"
        else:
            return "Late night feels 🌙"
    return MOOD_REASONS.get(mood, MOOD_REASONS["default"])
