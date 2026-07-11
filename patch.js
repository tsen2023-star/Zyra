const fs = require('fs');
let c = fs.readFileSync('App.tsx', 'utf8');

// 1. Add onLongPress
const regex = /(<TouchableOpacity[^>]*?onPress=\{[^}]*?handleTrackPress\([^}]*?\}[^>]*?)>/g;
c = c.replace(regex, (match, tag) => {
    if (!tag.includes('onLongPress=')) {
        const m = tag.match(/handleTrackPress\(([^)]+)\)/);
        if (m) {
            const songVar = m[1];
            return tag + ` onLongPress={() => { setContextMenuSong(${songVar}); setContextMenuVisible(true); }}>`;
        }
    }
    return match;
});

// 2. Tab Display Flex instead of Unmount
const reps = [
  [
    `        {/* -- HOME ----------------------------------------------------------- */}
        {currentScreen === 'all_songs' && (
          <View style={styles.screenBody}>`,
    `        {/* -- HOME ----------------------------------------------------------- */}
        <View style={[styles.screenBody, { display: currentScreen === 'all_songs' ? 'flex' : 'none' }]}>`
  ],
  [
    `        {/* -- SEARCH TAB -------------------------------------------------------- */}
        {currentScreen === 'search' && (
          <View style={styles.screenBody}>`,
    `        {/* -- SEARCH TAB -------------------------------------------------------- */}
        <View style={[styles.screenBody, { display: currentScreen === 'search' ? 'flex' : 'none' }]}>`
  ],
  [
    `        {/* -- LIBRARY ------------------------------------------------------- */}
        {currentScreen === 'library' && (
          <View style={styles.screenBody}>`,
    `        {/* -- LIBRARY ------------------------------------------------------- */}
        <View style={[styles.screenBody, { display: currentScreen === 'library' ? 'flex' : 'none' }]}>`
  ],
  [
    `        {/* -- SETTINGS TAB ------------------------------------------------------ */}
        {currentScreen === 'settings' && (
          <ScrollView style={styles.screenBody} showsVerticalScrollIndicator={false}>`,
    `        {/* -- SETTINGS TAB ------------------------------------------------------ */}
        <ScrollView style={[styles.screenBody, { display: currentScreen === 'settings' ? 'flex' : 'none' }]} showsVerticalScrollIndicator={false}>`
  ],
  [
    `              </ScrollView>

          </View>
        )}
        

        {/* -- SEARCH TAB`,
    `              </ScrollView>

          </View>
        

        {/* -- SEARCH TAB`
  ],
  [
    `              </ScrollView>
            )}
          </View>
        )}

{/* -- ALBUM VIEW`,
    `              </ScrollView>
            )}
          </View>

{/* -- ALBUM VIEW`
  ],
  [
    `              {favorites.map(song => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
            </ScrollView>
          </View>
        )}

        {/* -- LISTEN LATER`,
    `              {favorites.map(song => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
            </ScrollView>
          </View>

        {/* -- LISTEN LATER`
  ],
  [
    `                  </View>
                </View>
              </Modal>

            </ScrollView>
          </View>
        )}

        <View style={{ height: 100 }} />`,
    `                  </View>
                </View>
              </Modal>

            </ScrollView>
          </View>

        <View style={{ height: 100 }} />`
  ]
];

for (const [oldStr, newStr] of reps) {
    if (!c.includes(oldStr)) {
        console.error('Could not find string:\n' + oldStr);
    }
    c = c.replace(oldStr, newStr);
}

fs.writeFileSync('App.tsx', c, 'utf8');
