import re

with open('App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update fetchFeaturedPlaylists
old_fetch = '''  const fetchFeaturedPlaylists = useCallback(async () => {
    try {
      const keywords = ['bollywood', 'romance', 'workout', 'chill', 'party', 'lofi', 'punjabi', 'devotional', 'sufi', 'indie'];
      const randomKeyword = keywords[Math.floor(Math.random() * keywords.length)];
      const r = await fetch(`https://saavn.dev/api/search/playlists?query=${randomKeyword}&limit=10`);
      const j = await r.json();
      if (j.success && j.data?.results) {
        const playlists = j.data.results.map((p: any) => {
          const imgs = p.image || [];
          const img = imgs.find((i: any) => i.quality === '500x500')?.url || imgs[imgs.length - 1]?.url || '';
          return { id: p.id, title: p.title || p.name || '', subtitle: p.subtitle || p.description || '', image: img };
        }).filter((p: any) => p.image);
        setFeaturedPlaylists(playlists.sort(() => 0.5 - Math.random()));
      }
    } catch (e) { console.error('Featured playlists error', e); }
  }, []);'''

new_fetch = '''  const fetchFeaturedPlaylists = useCallback(async () => {
    try {
      const keywords = [
        { key: 'romantic', title: 'Romance', subtitle: 'Feel the love' },
        { key: 'workout', title: 'Workout', subtitle: 'Pump it up' },
        { key: 'chill', title: 'Chill', subtitle: 'Kick back & relax' },
        { key: 'party', title: 'Party', subtitle: 'Dance the night away' },
        { key: 'lofi', title: 'Lo-Fi', subtitle: 'Beats to study/relax to' },
        { key: 'devotional', title: 'Devotional', subtitle: 'Peaceful & spiritual' },
        { key: 'punjabi', title: 'Punjabi Hits', subtitle: 'Bhangra beats' },
        { key: 'pop', title: 'Pop Sensations', subtitle: 'Top chart bangers' }
      ];
      const results = await Promise.all(keywords.map(async (kw) => {
        try {
          const r = await fetch(`https://saavn.dev/api/search/playlists?query=${kw.key}&limit=10`);
          const j = await r.json();
          if (j.success && j.data?.results) {
            const playlists = j.data.results.map((p: any) => {
              const imgs = p.image || [];
              const img = imgs.find((i: any) => i.quality === '500x500')?.url || imgs[imgs.length - 1]?.url || '';
              return { id: p.id, title: p.title || p.name || '', subtitle: p.subtitle || p.description || '', image: img };
            }).filter((p: any) => p.image);
            return { title: kw.title, subtitle: kw.subtitle, items: playlists.sort(() => 0.5 - Math.random()) };
          }
        } catch {}
        return null;
      }));
      setFeaturedPlaylists(results.filter(Boolean));
    } catch (e) { console.error('Featured playlists error', e); }
  }, []);'''

content = content.replace(old_fetch, new_fetch)

# 2. Extract Moods & Genres block
mood_start = content.find('                {/* ── Moods & Genres — 3-column grid ── */}')
mood_end = content.find('                {/* ── Trending Now ── */}')
if mood_start != -1 and mood_end != -1:
    mood_block = content[mood_start:mood_end]
    # Remove from original
    content = content[:mood_start] + content[mood_end:]
    
    # 3. Update Featured Playlists UI
    old_ui = '''                {/* ── Featured Playlists (Posters) ── */}
                {featuredPlaylists.length > 0 && !isSearchFocused && (
                  <View style={{ marginBottom: 28, marginTop: 10 }}>
                    <Text style={[styles.echoSectionLabel, { marginBottom: 2 }]}>Echo Recommendations 🎶</Text>
                    <Text style={{ color: theme.subtext, fontSize: 11, fontStyle: 'italic', marginBottom: 12 }}>CURATED PLAYLISTS JUST FOR YOU</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {featuredPlaylists.map((pl, i) => (
                        <TouchableOpacity key={i} style={{ width: 140, height: 220, marginRight: 14, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.surface }}
                          onPress={async () => {
                            setCurrentMood('default');
                            setIsSearching(true);
                            setSearchQuery(pl.title);
                            try {
                              const r = await fetch(`https://saavn.dev/api/playlists?id=${pl.id}&limit=50`);
                              const pdata = await r.json();
                              const songsRaw = pdata.data?.songs || [];
                              if (songsRaw.length > 0) {
                                const mapped = songsRaw.map((s: any) => {
                                  const dl = s.downloadUrl || []; const im = s.image || [];
                                  return { id: s.id, title: (s.name || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'), artist: s.artists?.primary?.map((a:any) => a.name).join(', ') || '', image: im.find((i:any) => i.quality==='500x500')?.url || im[im.length-1]?.url || '', url: dl.find((u:any) => u.quality==='320kbps')?.url || dl[dl.length-1]?.url || '', duration: s.duration || 0 };
                                }).filter((s: any) => s.url);
                                if (mapped.length > 0) {
                                  setSongsList(mapped);
                                }
                              }
                            } catch {}
                            finally { setIsSearching(false); }
                          }}>
                          {pl.image ? <Image source={{ uri: pl.image }} style={{ width: '100%', height: '100%' }} /> : <View style={{ flex: 1, backgroundColor: moodColor }} />}
                          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, paddingTop: 30 }}>
                            <Text numberOfLines={2} style={{ color: '#fff', fontSize: 14, fontWeight: 'bold', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 }}>{pl.title}</Text>
                            <Text numberOfLines={1} style={{ color: '#ccc', fontSize: 11, marginTop: 4 }}>{pl.subtitle}</Text>
                          </LinearGradient>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}'''

    new_ui = '''                {/* ── Featured Playlists (Posters) ── */}
                {featuredPlaylists.length > 0 && !isSearchFocused && (
                  <View style={{ marginTop: 10 }}>
                    {featuredPlaylists.map((section: any, sectionIdx: number) => (
                      <View key={sectionIdx} style={{ marginBottom: 28 }}>
                        <Text style={[styles.echoSectionLabel, { marginBottom: 2 }]}>{section.title}</Text>
                        <Text style={{ color: theme.subtext, fontSize: 11, fontStyle: 'italic', marginBottom: 12, textTransform: 'uppercase' }}>{section.subtitle}</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          {section.items.map((pl: any, i: number) => (
                            <TouchableOpacity key={i} style={{ width: 140, height: 220, marginRight: 14, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.surface }}
                              onPress={async () => {
                                setCurrentMood('default');
                                setIsSearching(true);
                                setSearchQuery(pl.title);
                                try {
                                  const r = await fetch(`https://saavn.dev/api/playlists?id=${pl.id}&limit=50`);
                                  const pdata = await r.json();
                                  const songsRaw = pdata.data?.songs || [];
                                  if (songsRaw.length > 0) {
                                    const mapped = songsRaw.map((s: any) => {
                                      const dl = s.downloadUrl || []; const im = s.image || [];
                                      return { id: s.id, title: (s.name || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'), artist: s.artists?.primary?.map((a:any) => a.name).join(', ') || '', image: im.find((i:any) => i.quality==='500x500')?.url || im[im.length-1]?.url || '', url: dl.find((u:any) => u.quality==='320kbps')?.url || dl[dl.length-1]?.url || '', duration: s.duration || 0 };
                                    }).filter((s: any) => s.url);
                                    if (mapped.length > 0) {
                                      setSongsList(mapped);
                                    }
                                  }
                                } catch {}
                                finally { setIsSearching(false); }
                              }}>
                              {pl.image ? <Image source={{ uri: pl.image }} style={{ width: '100%', height: '100%' }} /> : <View style={{ flex: 1, backgroundColor: moodColor }} />}
                              <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, paddingTop: 30 }}>
                                <Text numberOfLines={2} style={{ color: '#fff', fontSize: 14, fontWeight: 'bold', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 }}>{pl.title}</Text>
                                <Text numberOfLines={1} style={{ color: '#ccc', fontSize: 11, marginTop: 4 }}>{pl.subtitle}</Text>
                              </LinearGradient>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    ))}
                  </View>
                )}\n\n''' + mood_block
    
    content = content.replace(old_ui, new_ui)

with open('App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
