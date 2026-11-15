# Curialy Anime Archetype & Design System Atlas

This library contains 10 distinct, production-ready website archetypes created for anime, media, streaming, and entertainment platforms.

## Core Directives for Curialy API Agent
1. **Primary Target**: Optimized for anime, manga, animation, and entertainment websites.
2. **Cross-Domain Adaptability**: The fonts, color palettes, card patterns, hero designs, and filter mechanics can and SHOULD be adapted to ANY website if it suits the project vibe (e.g. Kuro Luxury for high-end SaaS/fashion, Otaku OS for developer tools/terminals, Anime Grid for e-commerce/databases, Frame Editorial for publications/blogs, Slice of Life for wellness/cafes).
3. **NEVER COPY A MOCK VERBATIM**: Do not output a 1:1 carbon copy of any template.
4. **ALWAYS CREATE A MIXTURE / SYNTHESIS**:
   - Synthesize components from 2, 3, or more archetypes.
   - Example 1: Use Kuro Cinema's luxury dark palette and episode guide + Nebula Anime's horizontal scrollable shelves + Anime Grid's filter sidebar.
   - Example 2: Use Shonen Hub's high-energy typography and angled badges + Otaku OS's live audio visualizer signal panel + Slice of Life's continue watching progress cards.
   - Example 3: Use Kitsune Flix's traditional Japanese serif typography & inkan seals + Frame Anime's critics review score card + Sakura Stream's delicate pastel details.

---

## The 10 Archetypes

### 01_slice_of_life_cozy.html — Slice of Life — A little room to unwind
- **ID**: `anime-cozy-slice-of-life`
- **Style**: Warm Cozy / Hearthside Minimal
- **Fonts**: Fraunces (serif) + DM Sans (sans-serif)
- **Palette**: `{"cream":"#f8f6ef","paper":"#fffdf8","ink":"#303d32","green":"#375d48","sage":"#dbe5d7","brown":"#a67d66","peach":"#f3e4d5"}`
- **Key Components**: Pill search header, Cozy evening hero with warm gradient, Mood-based filter pills, Series cards with play badge, Tonights pick spotlight, Curated dual collection tiles, Continue watching cards with episode progress bars, Modal details dialog

### 02_kuro_cinema_luxury.html — KURO CINEMA — A Different Kind of Anime Experience
- **ID**: `anime-luxury-kuro-cinema`
- **Style**: Luxury Cinematic / High-End Obsidian & Gold
- **Fonts**: Playfair Display (serif) + DM Sans (sans-serif)
- **Palette**: `{"bg":"#090a09","surface":"#111310","surface2":"#171914","gold":"#d5bb82","goldLight":"#f0dfb6","muted":"#a3a39a","line":"#36362f","white":"#f3f0e8"}`
- **Key Components**: Minimalist luxury topbar with gold diamond mark, Fullscreen editorial hero with italic accents, Numbered premiere grid (01, 02, 03), Split collection cards (After Dark, Myths & Memory), Membership club perks grid with clean icon rules, Deep-dive detail page with film notes sidebar & interactive episode guide

### 03_anime_arcade_synthwave.html — ANIME ARCADE — Press Start to Discover
- **ID**: `anime-retro-arcade-synthwave`
- **Style**: Retro 80s/90s Synthwave & Pixel Arcade
- **Fonts**: Press Start 2P (pixel monospace) + DM Sans (sans-serif)
- **Palette**: `{"bg":"#0c0a22","panel":"#17143a","panel2":"#211c50","pink":"#ff5cc8","blue":"#64c8ff","yellow":"#ffe17b","purple":"#9b75ff","line":"#6159a7"}`
- **Key Components**: Pixel ticker banner, Polygon badge with blinking beacon, Vector synthwave hero with geometric sun/mountain/figure, Player Hub dashboard (5-day streak tracker, achievement tabs, rotating vinyl disc), Arcade world filter pills, Retro anime cards with gradient covers, rating stars, and badges

### 04_frame_anime_editorial.html — FRAME ANIME — Stories Worth Staying For
- **ID**: `anime-editorial-frame-magazine`
- **Style**: Avant-Garde Print Editorial / Magazine Masthead
- **Fonts**: Manrope (geometric display sans) + Playfair Display (editorial serif) + DM Sans (sans-serif)
- **Palette**: `{"paper":"#f5f3ee","ink":"#20211f","muted":"#777872","red":"#bb4c3e","line":"#d4d3cb","white":"#fffdf8"}`
- **Key Components**: Two-tier newspaper masthead with volume/issue tracker, Split cover story with circular action button & vertical text, Asymmetric premiere showcase, Critics review section with giant 9.2/10 score and oversized quote marks, Seasonal editorial split-banner, Poster grid with genre filters and search overlay

### 05_shonen_hub_action.html — SHONEN HUB — The Next Battle Starts Here
- **ID**: `anime-action-shonen-hub`
- **Style**: High-Octane Shonen Action / Aggressive Angular
- **Fonts**: Barlow Condensed (ultra-bold italic) + DM Sans (sans-serif)
- **Palette**: `{"bg":"#0b0b0d","surface":"#17171a","surface2":"#202024","red":"#f03b32","orange":"#ff8c32","muted":"#aaa5a4","line":"#393134","text":"#fff8f3"}`
- **Key Components**: Skewed brand mark and angled live ticker, High-contrast action hero with skewed polygon buttons, Trending battle cards with massive watermark numerals (01..04), Ongoing spotlight feature panel with episode thumbnail list, Character champion cards (The lone swordsman, The fearless guardian)

### 06_nebula_anime_cosmic_streaming.html — NEBULA ANIME — Beyond the ordinary
- **ID**: `anime-streaming-nebula-cosmic`
- **Style**: Cosmic Neon Streaming / Glassmorphism Platform
- **Fonts**: Space Grotesk (tech sans) + DM Sans (sans-serif)
- **Palette**: `{"bg":"#080910","panel":"#151621","text":"#f7f6ff","muted":"#a9a9bd","violet":"#a875ff","line":"rgba(255,255,255,0.13)"}`
- **Key Components**: Floating glassmorphism pill navigation with backdrop-filter blur, Cosmic hero with pulsing radial glow and animated drift, Horizontal scrollable shelf carousels with smooth scroll snap and arrow controls, Card hover play button reveal with watch progress bar, Glassmorphic modal preview with video placeholder metadata

### 07_anime_grid_catalog_index.html — Anime Grid — Discover your next favorite
- **ID**: `anime-catalog-anime-grid`
- **Style**: Structured Tech Catalog / Deep Filtering Index
- **Fonts**: Space Grotesk (bold display) + DM Sans (sans-serif)
- **Palette**: `{"bg":"#101116","panel":"#191b22","panel2":"#20222b","line":"#30323b","text":"#f3f2ef","muted":"#9698a3","accent":"#ff6b57","accent2":"#ffb197"}`
- **Key Components**: Header with quick slash search shortcut (/), Sidebar filter panel (multi-checkbox genres, year dropdown, format, status, minimum rating slider), Active filter tags/chips with instant dismissal, Results header with sort dropdown and title counter, Geometric CSS poster cards with kanji watermarks and corner rating badges, Pagination controls

### 08_otaku_os_cyberpunk_terminal.html — OTAKU OS — Your Anime Universe
- **ID**: `anime-terminal-otaku-os`
- **Style**: Cyberpunk Terminal / Futuristic Desktop OS
- **Fonts**: Space Grotesk (tech display) + DM Sans (sans-serif)
- **Palette**: `{"bg":"#07090e","surface":"#0e131c","surface2":"#121a26","line":"#273443","cyan":"#54f5f4","pink":"#fa55cb","text":"#edf7fb","muted":"#8799a8"}`
- **Key Components**: Left vertical OS app dock and navigation, Real-time system signal monitor with animated audio visualizer bars, Top status bar with live 24h clock and ONLINE beacon, CLI command prompt search (>), Dossier cards with file numbers (01 / FILE), Title dossier confidential modal viewer

### 09_sakura_stream_pastel_romance.html — Sakura Stream — Stories worth getting lost in
- **ID**: `anime-pastel-sakura-stream`
- **Style**: Romantic Pastel / Delicate Japanese Spring
- **Fonts**: DM Serif Display (soft serif) + DM Sans (sans-serif)
- **Palette**: `{"bg":"#f8f6f2","paper":"#ffffff","ink":"#221d2b","muted":"#827d86","accent":"#e46b70","line":"#eae5e4","cherryBlossom":"#fbe0df"}`
- **Key Components**: Soft serif branding with blossom icon, Warm photographic hero with rounded pill button, Seasonal daydreams filter chips, Aspect ratio 4:5 poster cards with subtle hover scale, Horizontal popular story rows with thumbnail and rating, Mobile bottom dock navigation

### 10_kitsune_flix_traditional_japanese.html — KITSUNE FLIX — Stories beyond the ordinary
- **ID**: `anime-traditional-kitsune-flix`
- **Style**: Traditional Japanese / Washi Paper & Vermilion Inkan
- **Fonts**: Shippori Mincho (traditional Japanese serif) + Noto Sans JP (Japanese sans) + DM Sans (sans-serif)
- **Palette**: `{"paper":"#f6f2e9","paper2":"#eee8dc","ink":"#282724","muted":"#777268","red":"#a9362d","red2":"#76271f","line":"#d9d0c1"}`
- **Key Components**: Circular inkan red seal emblem, Vertical Japanese typography sidebars (物語の世界へ), Textured washi paper background with subtle noise grain, Traditional kanji subtitle labels (紅の誓い, 精霊の集う場所), Refined cards with kanji numbering and editorial line links, Split philosophy section with authentic seal badge

