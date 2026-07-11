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

replacements = [
  (
    \"\"\"        {/* -- HOME ----------------------------------------------------------- */}
        {currentScreen === 'all_songs' && (
          <View style={styles.screenBody}>\"\"\",
    \"\"\"        {/* -- HOME ----------------------------------------------------------- */}
        <View style={[styles.screenBody, { display: currentScreen === 'all_songs' ? 'flex' : 'none' }]}>\"\"\"
  ),
  (
    \"\"\"        {/* -- SEARCH TAB -------------------------------------------------------- */}
        {currentScreen === 'search' && (
          <View style={styles.screenBody}>\"\"\",
    \"\"\"        {/* -- SEARCH TAB -------------------------------------------------------- */}
        <View style={[styles.screenBody, { display: currentScreen === 'search' ? 'flex' : 'none' }]}>\"\"\"
  ),
  (
    \"\"\"        {/* -- LIBRARY ------------------------------------------------------- */}
        {currentScreen === 'library' && (
          <View style={styles.screenBody}>\"\"\",
    \"\"\"        {/* -- LIBRARY ------------------------------------------------------- */}
        <View style={[styles.screenBody, { display: currentScreen === 'library' ? 'flex' : 'none' }]}>\"\"\"
  ),
  (
    \"\"\"        {/* -- SETTINGS TAB ------------------------------------------------------ */}
        {currentScreen === 'settings' && (
          <View style={styles.screenBody}>\"\"\",
    \"\"\"        {/* -- SETTINGS TAB ------------------------------------------------------ */}
        <View style={[styles.screenBody, { display: currentScreen === 'settings' ? 'flex' : 'none' }]}>\"\"\"
  ),
  (
    \"\"\"              </ScrollView>

          </View>
        )}
        

        {/* -- SEARCH TAB\"\"\",
    \"\"\"              </ScrollView>

          </View>
        

        {/* -- SEARCH TAB\"\"\"
  ),
  (
    \"\"\"              </ScrollView>
            )}
          </View>
        )}

{/* -- ALBUM VIEW\"\"\",
    \"\"\"              </ScrollView>
            )}
          </View>

{/* -- ALBUM VIEW\"\"\"
  ),
  (
    \"\"\"              {favorites.map(song => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
            </ScrollView>
          </View>
        )}

        {/* -- LISTEN LATER\"\"\",
    \"\"\"              {favorites.map(song => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
            </ScrollView>
          </View>

        {/* -- LISTEN LATER\"\"\"
  ),
  (
    \"\"\"                  </View>
                </View>
              </Modal>

            </ScrollView>
          </View>
        )}

        <View style={{ height: 100 }} />\"\"\",
    \"\"\"                  </View>
                </View>
              </Modal>

            </ScrollView>
          </View>

        <View style={{ height: 100 }} />\"\"\"
  )
]

for old, new in replacements:
    c = c.replace(old, new)

with open('App.tsx', 'w', encoding='utf-8') as f:
    f.write(c)
