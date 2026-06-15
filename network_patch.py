import re

with open('App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace hardcoded '320kbps' quality checks with audioQuality state
content = re.sub(
    r"u\.quality\s*===\s*'320kbps'",
    r"u.quality === audioQuality",
    content
)

with open('App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Audio quality network optimization applied.")
