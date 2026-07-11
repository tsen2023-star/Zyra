import re

with open('App.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

def replacer(match):
    tag = match.group(1)
    if 'onLongPress=' not in tag:
        m = re.search(r'handleTrackPress\(([^)]+)\)', tag)
        if m:
            song_var = m.group(1)
            return tag + f' onLongPress={{() => {{ setContextMenuSong({song_var}); setContextMenuVisible(true); }}}}>'
    return match.group(0)

c = re.sub(r'(<TouchableOpacity[^>]*?onPress=\{[^}]*?handleTrackPress\([^}]*?\}[^>]*?)>', replacer, c)

c = re.sub(
    r"\{\s*currentScreen === 'all_songs' && \(\s*<View style=\{styles\.screenBody\}>",
    r"<View style={[styles.screenBody, { display: currentScreen === 'all_songs' ? 'flex' : 'none' }]}>",
    c
)
c = re.sub(
    r"\{\s*currentScreen === 'search' && \(\s*<View style=\{styles\.screenBody\}>",
    r"<View style={[styles.screenBody, { display: currentScreen === 'search' ? 'flex' : 'none' }]}>",
    c
)
c = re.sub(
    r"\{\s*currentScreen === 'library' && \(\s*<View style=\{styles\.screenBody\}>",
    r"<View style={[styles.screenBody, { display: currentScreen === 'library' ? 'flex' : 'none' }]}>",
    c
)
c = re.sub(
    r"\{\s*currentScreen === 'settings' && \(\s*<ScrollView style=\{styles\.screenBody\} showsVerticalScrollIndicator=\{false\}>",
    r"<ScrollView style={[styles.screenBody, { display: currentScreen === 'settings' ? 'flex' : 'none' }]} showsVerticalScrollIndicator={false}>",
    c
)

c = re.sub(
    r"(</ScrollView>\s*)</View>\s*\)\}\s*\{\/\*\s*── SEARCH TAB",
    r"\g<1></View>\n\n        {/* ── SEARCH TAB",
    c
)
c = re.sub(
    r"(</ScrollView>\s*\}\)\}\s*</View>\s*)\)\}\s*\{\/\*\s*── ALBUM VIEW",
    r"\g<1>\n\n{/* ── ALBUM VIEW",
    c
)
c = re.sub(
    r"(</ScrollView>\s*</View>\s*)\)\}\s*\{\/\*\s*── LISTEN LATER",
    r"\g<1>\n\n        {/* ── LISTEN LATER",
    c
)
c = re.sub(
    r"(</ScrollView>\s*</View>\s*)\)\}\s*<View style=\{\{\s*height:\s*100\s*\}\}",
    r"\g<1>\n\n        <View style={{ height: 100 }}",
    c
)

with open('App.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

print("Patch applied.")
