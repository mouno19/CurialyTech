// Style archetypes: fifteen complete visual systems taken from the staged anime and entertainment
// templates (component-library/anime-templates). Built for anime and media sites, but each one's
// type, colour, layout and interaction language fits other subjects with the same character
// (`fits`). They are never used whole: a design takes its base from one and borrows blocks and
// details from others, all on one token set (see ../synthesis.ts).
//
// Tokens are the templates' own (:root custom properties). Where a template's muted or accent
// colour is under 4.5:1 as text on its own background, `textSafe` gives the nearest shade that
// passes on both the background and the raised surface (the template colour stays for fills,
// unless a label on it fails too: then the shade is the fill as well).

/** Looks an archetype is built on: choosing it deliberately lifts the matching "generic tell" warnings and audit findings. */
export type GrantedLook = "violet" | "gradient-text" | "glass" | "marquee" | "tasteful" | "eyebrow" | "reflex-type" | "numerals";

export type ArchetypeTokens = {
  bg: string; surface: string; surface2: string; line: string; text: string; muted: string;
  accent: string; accent2: string;
  /** Text on an accent fill (buttons, badges). */
  onAccent: string;
};

export type Archetype = {
  /** The template's id (component-library/anime-templates/README.md). */
  id: string;
  name: string;
  style: string;
  file: string;
  mode: "light" | "dark";
  concept: string;
  fonts: { display: string; text: string; extra?: string; use: string };
  tokens: ArchetypeTokens;
  /** Shades to use for text where the template's own colour is under 4.5:1 (role → hex). */
  textSafe?: Partial<Record<"muted" | "accent" | "accent2", string>>;
  radius: string;
  /**
   * Its signature blocks: registered in the component library under these ids (add_components
   * re-skins them to the chosen tokens). looks: what a block brings when it is borrowed alone.
   */
  blocks: { id: string; name: string; how: string; looks?: GrantedLook[] }[];
  layout: string;
  motion: string;
  /** What it suits beyond anime and media sites. */
  fits: string[];
  /** Request words that point to it (lowercase, matched at word starts). */
  signals: string[];
  grants: GrantedLook[];
  /** What breaks it. */
  avoid: string;
};

export const ARCHETYPES: Archetype[] = [
  {
    id: "anime-cozy-slice-of-life", name: "Slice of Life", style: "Warm cozy, hearthside minimal", file: "01_slice_of_life_cozy.html", mode: "light",
    concept: "An evening room: warm paper, sage and peach, soft rounded cards, mood before metadata.",
    fonts: { display: "Fraunces", text: "DM Sans", use: "Fraunces 600 for headlines and titles (optical size high), DM Sans 400/500 for everything else." },
    tokens: { bg: "#f8f6ef", surface: "#fffdf8", surface2: "#dbe5d7", line: "#e8e8dc", text: "#303d32", muted: "#788477", accent: "#375d48", accent2: "#a67d66", onAccent: "#fffdf8" },
    textSafe: { muted: "#677166", accent2: "#8c6752" },
    radius: "15-25px cards, pill buttons and search",
    blocks: [
      { id: "anime-cozy-header", name: "Pill search header", how: "logo, quiet nav and a rounded search pill" },
      { id: "anime-cozy-hero", name: "Evening hero", how: "warm gradient panel, one headline, one action" },
      { id: "anime-cozy-mood-filters", name: "Mood filter pills", how: "filter by feeling (cozy, healing, nostalgic) instead of genre" },
      { id: "anime-cozy-tonight", name: "Tonight's pick", how: "one recommendation with a short reason and runtime" },
      { id: "anime-cozy-collections", name: "Dual collection tiles", how: "two curated tiles side by side" },
      { id: "anime-cozy-continue", name: "Continue watching", how: "cards with episode progress bars" },
    ],
    layout: "Generous single column of calm sections; filters as pills above a soft grid.",
    motion: "Almost none: gentle hover tints, no movement for its own sake.",
    fits: ["wellness", "lifestyle app", "cafe", "bakery", "reading club", "cozy community", "journaling", "slow living"],
    signals: ["cozy", "slice of life", "hygge", "cafe", "café", "reading club", "healing", "wellness", "tea room"],
    grants: ["tasteful"],
    avoid: "Hard blacks, neon, dense data; rush and urgency in the copy.",
  },
  {
    id: "anime-luxury-kuro-cinema", name: "Kuro Cinema", style: "Luxury cinematic, obsidian and gold", file: "02_kuro_cinema_luxury.html", mode: "dark",
    concept: "A private screening room: obsidian surfaces, a thin gold line, wide editorial imagery, restraint.",
    fonts: { display: "Playfair Display", text: "DM Sans", use: "Playfair Display 400/700 with italic accents for display, DM Sans 400 for text; small tracked labels sparingly." },
    tokens: { bg: "#090a09", surface: "#111310", surface2: "#171914", line: "#36362f", text: "#f3f0e8", muted: "#a3a39a", accent: "#d5bb82", accent2: "#f0dfb6", onAccent: "#090a09" },
    radius: "square (0), hairline gold rules instead of rounded cards",
    blocks: [
      { id: "anime-kuro-topbar", name: "Gold diamond topbar", how: "minimal bar, diamond mark, few links" },
      { id: "anime-kuro-hero", name: "Editorial full-bleed hero", how: "large title with an italic accent over wide imagery" },
      { id: "anime-kuro-premieres", name: "Numbered premiere grid", how: "01-03 premieres as a ranked editorial grid", looks: ["numerals"] },
      { id: "anime-kuro-collections", name: "Split collection cards", how: "two large collections with mood names" },
      { id: "anime-kuro-membership", name: "Membership perks", how: "perks grid with icon rules, one quiet plan action" },
      { id: "anime-kuro-detail", name: "Title detail with film notes and episode guide", how: "detail page: notes sidebar and an interactive episode list" },
    ],
    layout: "Full-bleed hero, then wide rows on a 12-column grid with large gutters; one gold accent per view.",
    motion: "Slow fades and image reveals only.",
    fits: ["premium saas", "fashion", "fine dining", "architecture", "luxury goods", "hotel", "jewelry", "private club", "cinema"],
    signals: ["luxury", "luxurious", "premium", "high-end", "cinematic", "cinema", "gold", "fashion", "fine dining", "architecture", "vip", "couture"],
    grants: ["eyebrow", "numerals"],
    avoid: "Saturated colour, many accents, crowded cards, playful motion.",
  },
  {
    id: "anime-retro-arcade-synthwave", name: "Anime Arcade", style: "Retro synthwave and pixel arcade", file: "03_anime_arcade_synthwave.html", mode: "dark",
    concept: "An 80s arcade at night: pixel type for labels, neon pink, cyan and yellow on deep indigo, game mechanics as UI.",
    fonts: { display: "Press Start 2P", text: "DM Sans", use: "Press Start 2P only for short labels, scores and the logo (it is hard to read at length); DM Sans for all body text." },
    tokens: { bg: "#0c0a22", surface: "#17143a", surface2: "#211c50", line: "#6159a7", text: "#f8f5ff", muted: "#aea9d1", accent: "#ff5cc8", accent2: "#64c8ff", onAccent: "#0c0a22" },
    radius: "small (7px) or none; pixel-stepped borders",
    blocks: [
      { id: "anime-arcade-header", name: "Pixel ticker header", how: "logo with a blinking beacon over a scrolling ticker", looks: ["marquee"] },
      { id: "anime-arcade-hero", name: "Synthwave hero", how: "vector sun, mountains and a figure; one start action", looks: ["violet"] },
      { id: "anime-arcade-player-hub", name: "Player hub", how: "5-day streak tracker, achievement tabs and a spinning disc" },
      { id: "anime-arcade-discovery", name: "Arcade discovery grid", how: "world filter pills and cards with gradient covers, stars and badges" },
    ],
    layout: "Framed panels like a cabinet screen; HUD-style counters and progress.",
    motion: "Expressive but bounded: a ticker, a blinking beacon, a slow disc spin; all off under reduced motion.",
    fits: ["gaming", "web3", "crypto", "nft", "events", "creative studio", "hackathon", "music"],
    signals: ["retro", "arcade", "pixel", "8-bit", "synthwave", "vaporwave", "80s", "neon", "web3", "crypto", "esports event", "hackathon"],
    grants: ["violet", "marquee", "eyebrow"],
    avoid: "Pixel type for paragraphs; neon on every element (keep one neon per component).",
  },
  {
    id: "anime-editorial-frame-magazine", name: "Frame Anime", style: "Avant-garde print editorial, magazine masthead", file: "04_frame_anime_editorial.html", mode: "light",
    concept: "A printed magazine: paper and ink, a red editorial mark, a masthead with volume and issue, asymmetric layouts.",
    fonts: { display: "Playfair Display", text: "DM Sans", extra: "Manrope", use: "Playfair Display for headlines and quotes, Manrope 700-800 for the masthead and section labels, DM Sans for text." },
    tokens: { bg: "#f5f3ee", surface: "#fffdf8", surface2: "#ebe8e0", line: "#d4d3cb", text: "#20211f", muted: "#777872", accent: "#bb4c3e", accent2: "#20211f", onAccent: "#fffdf8" },
    textSafe: { muted: "#6d6e68", accent: "#b74a3d" },
    radius: "none (print); the one circle is the cover's action button",
    blocks: [
      { id: "anime-frame-masthead", name: "Masthead with volume and issue", how: "two-tier newspaper header", looks: ["eyebrow"] },
      { id: "anime-frame-cover", name: "Cover story", how: "split cover with a circular action and vertical text" },
      { id: "anime-frame-premieres", name: "Asymmetric premiere showcase", how: "one large and two small premieres" },
      { id: "anime-frame-critics", name: "Critics review", how: "a giant 9.2/10 score and oversized quote marks" },
      { id: "anime-frame-season", name: "Seasonal split banner", how: "editorial banner with a strong image half" },
      { id: "anime-frame-collection", name: "Poster grid with genre filters", how: "posters with filter tabs and a search overlay" },
    ],
    layout: "Asymmetric columns, rules between sections, captions and bylines; reading measure 60-70ch.",
    motion: "None beyond hover underlines.",
    fits: ["literary magazine", "art blog", "newsletter", "creative portfolio", "publishing", "film review", "journal"],
    signals: ["magazine", "editorial", "newspaper", "masthead", "print", "journal", "zine", "literary"],
    grants: ["tasteful", "eyebrow"],
    avoid: "Rounded cards and shadows; centred hero templates.",
  },
  {
    id: "anime-action-shonen-hub", name: "Shonen Hub", style: "High-octane action, aggressive angular", file: "05_shonen_hub_action.html", mode: "dark",
    concept: "A battle arena: black and fire red, condensed bold italics, skewed shapes, rank numerals.",
    fonts: { display: "Barlow Condensed", text: "DM Sans", use: "Barlow Condensed 800-900 italic uppercase for headlines and badges, DM Sans for text." },
    tokens: { bg: "#0b0b0d", surface: "#17171a", surface2: "#202024", line: "#393134", text: "#fff8f3", muted: "#aaa5a4", accent: "#f03b32", accent2: "#ff8c32", onAccent: "#0b0b0d" },
    radius: "none; skewed (-8 to -12deg) badges and buttons",
    blocks: [
      { id: "anime-shonen-header", name: "Skewed brand and live ticker", how: "angled mark with a live ticker", looks: ["marquee"] },
      { id: "anime-shonen-hero", name: "Action hero", how: "high-contrast hero with skewed polygon buttons" },
      { id: "anime-shonen-trending", name: "Trending cards with rank numerals", how: "cards over giant 01-04 rank numerals", looks: ["numerals"] },
      { id: "anime-shonen-discover", name: "Top-rated grid", how: "dense rated cards" },
      { id: "anime-shonen-episodes", name: "Ongoing spotlight", how: "feature panel with an episode thumbnail list" },
      { id: "anime-shonen-characters", name: "Champion cards", how: "character cards with role lines" },
    ],
    layout: "Diagonals and overlaps; big numerals for real ranks only.",
    motion: "Fast, short (150-250 ms) slides and a ticker; never bouncy.",
    fits: ["fitness", "gym", "sports", "competitive gaming", "esports", "energy drink", "martial arts", "racing"],
    signals: ["shonen", "battle", "fight", "sports", "gym", "fitness", "esports", "competitive", "racing", "tournament", "martial arts"],
    grants: ["marquee", "eyebrow", "numerals"],
    avoid: "Soft pastels, rounded friendly shapes, slow luxury pacing.",
  },
  {
    id: "anime-streaming-nebula-cosmic", name: "Nebula Anime", style: "Cosmic neon streaming, glassmorphism platform", file: "06_nebula_anime_cosmic_streaming.html", mode: "dark",
    concept: "A streaming platform in deep space: violet glow, a floating glass nav, horizontal shelves you scroll.",
    fonts: { display: "Space Grotesk", text: "DM Sans", use: "Space Grotesk 600-700 for titles and shelf headings, DM Sans for text and metadata." },
    tokens: { bg: "#080910", surface: "#151621", surface2: "#1d1e2c", line: "#2a2b3a", text: "#f7f6ff", muted: "#a9a9bd", accent: "#a875ff", accent2: "#d7b6ff", onAccent: "#080910" },
    radius: "18px panels, 50px pills, 5px chips",
    blocks: [
      { id: "anime-nebula-nav", name: "Floating glass nav", how: "a pill navigation with backdrop blur (the one glass element)", looks: ["glass"] },
      { id: "anime-nebula-hero", name: "Cosmic hero", how: "radial glow with a slow drift behind one featured title", looks: ["violet"] },
      { id: "anime-nebula-shelf-trending", name: "Scrolling shelf", how: "horizontal scroll-snap row with arrow controls" },
      { id: "anime-nebula-shelf-popular", name: "Popular shelf", how: "a second shelf with rank and rating" },
      { id: "anime-nebula-shelf-recent", name: "Recently added shelf", how: "new arrivals with dates" },
      { id: "anime-nebula-continue", name: "Continue watching shelf", how: "cards with a play reveal on hover and a progress bar" },
    ],
    layout: "Hero then stacked shelves; content density from rows, not grids.",
    motion: "Ambient: a slow glow drift and hover reveals; still under reduced motion.",
    fits: ["saas product tour", "video platform", "music streaming", "multimedia discovery", "podcast app", "course platform"],
    signals: ["streaming", "netflix", "video platform", "cosmic", "space", "galaxy", "glassmorphism", "glow", "binge"],
    grants: ["violet", "glass", "reflex-type"],
    avoid: "Glass on every card (only the nav floats); more than one glow per view.",
  },
  {
    id: "anime-catalog-anime-grid", name: "Anime Grid", style: "Structured tech catalog, deep filtering index", file: "07_anime_grid_catalog_index.html", mode: "dark",
    concept: "A precise index: a filter sidebar, chips, sort and counts, posters as geometric CSS with kanji watermarks.",
    fonts: { display: "Space Grotesk", text: "DM Sans", use: "Space Grotesk 700-800 for titles and counts, DM Sans for filters and metadata; tabular numbers." },
    tokens: { bg: "#101116", surface: "#191b22", surface2: "#20222b", line: "#30323b", text: "#f3f2ef", muted: "#9698a3", accent: "#ff6b57", accent2: "#ffb197", onAccent: "#101116" },
    radius: "4-9px controls and posters",
    blocks: [
      { id: "anime-grid-topbar", name: "Header with slash search", how: "search focused by the / key" },
      { id: "anime-grid-intro", name: "Catalog intro", how: "title, count and category tabs" },
      { id: "anime-grid-filters", name: "Filter sidebar", how: "genre checkboxes, year, format, status and a minimum-rating slider" },
      { id: "anime-grid-results", name: "Results grid", how: "active filter chips, sort dropdown, counter, poster cards with rating badges, and pagination" },
    ],
    layout: "Sidebar 240-280px plus a results grid; the filter state is always visible.",
    motion: "Functional only: chip removal and result updates.",
    fits: ["e-commerce catalog", "directory", "job board", "real estate listings", "marketplace", "database browser", "library catalog"],
    signals: ["catalog", "catalogue", "directory", "listings", "job board", "marketplace", "real estate"],
    grants: ["reflex-type"],
    avoid: "Decoration that competes with the results; hidden filter state.",
  },
  {
    id: "anime-terminal-otaku-os", name: "Otaku OS", style: "Cyberpunk terminal, futuristic desktop OS", file: "08_otaku_os_cyberpunk_terminal.html", mode: "dark",
    concept: "A desktop OS: an app dock, a status bar with a live clock, a signal monitor, a > prompt as search, dossiers as cards.",
    fonts: { display: "Space Grotesk", text: "DM Sans", use: "Space Grotesk for labels and titles, DM Sans for text; a monospace for the prompt and file numbers." },
    tokens: { bg: "#07090e", surface: "#0e131c", surface2: "#121a26", line: "#273443", text: "#edf7fb", muted: "#8799a8", accent: "#54f5f4", accent2: "#fa55cb", onAccent: "#07090e" },
    radius: "3-8px; hairline borders",
    blocks: [
      { id: "anime-otaku-dock", name: "App dock with signal monitor", how: "left dock and an animated audio-visualizer signal panel", looks: ["violet"] },
      { id: "anime-otaku-statusbar", name: "Status bar with prompt search", how: "> command search, live 24h clock and an ONLINE beacon" },
      { id: "anime-otaku-featured", name: "Featured dossier", how: "a title presented as a confidential file" },
      { id: "anime-otaku-archive", name: "Archive of dossier cards", how: "cards numbered as files (01 / FILE)", looks: ["numerals"] },
      { id: "anime-otaku-status-footer", name: "Bottom status line", how: "system readouts in a footer bar" },
    ],
    layout: "Window chrome: dock, status bar, panes; dense and aligned.",
    motion: "Live, small: a visualizer, a ticking clock, a blinking cursor; static under reduced motion.",
    fits: ["developer portal", "cybersecurity dashboard", "cli tool", "terminal app", "trading terminal", "devops console", "hacker event"],
    signals: ["cyberpunk", "terminal", "cli", "command line", "hacker", "developer portal", "devtools", "cyber", "cybersecurity", "matrix"],
    grants: ["violet", "reflex-type", "eyebrow", "numerals"],
    avoid: "Glow on everything; illegible thin text on black.",
  },
  {
    id: "anime-pastel-sakura-stream", name: "Sakura Stream", style: "Romantic pastel, delicate Japanese spring", file: "09_sakura_stream_pastel_romance.html", mode: "light",
    concept: "Spring light: blush paper, a cherry-blossom accent, soft serif titles, organic rounded cards.",
    fonts: { display: "DM Serif Display", text: "DM Sans", use: "DM Serif Display for titles, DM Sans 400/700 for text." },
    tokens: { bg: "#f8f6f2", surface: "#ffffff", surface2: "#fbe0df", line: "#eae5e4", text: "#221d2b", muted: "#827d86", accent: "#e46b70", accent2: "#cf5d69", onAccent: "#221d2b" },
    textSafe: { muted: "#736e76", accent: "#c4404a", accent2: "#c4404a" },
    radius: "15-16px cards, 99px pills",
    blocks: [
      { id: "anime-sakura-sidebar", name: "Blossom sidebar", how: "soft serif brand and a quiet menu" },
      { id: "anime-sakura-hero", name: "Photographic hero", how: "warm image with a rounded pill action" },
      { id: "anime-sakura-seasonal", name: "Seasonal chips and posters", how: "filter chips and 4:5 posters with a gentle hover" },
      { id: "anime-sakura-popular", name: "Popular story rows", how: "horizontal rows with a thumbnail and rating" },
      { id: "anime-sakura-recent", name: "Reader favourites", how: "small curated picks" },
      { id: "anime-sakura-mobile-dock", name: "Mobile bottom dock", how: "a floating bottom navigation on phones" },
    ],
    layout: "Sidebar on desktop, bottom dock on phones; airy rows of 4:5 posters.",
    motion: "Soft: hover scale 1.02-1.03, petals only if the request asks for them.",
    fits: ["florist", "wedding", "romance novels", "beauty brand", "pastry shop", "skincare", "stationery"],
    signals: ["pastel", "romance", "romantic", "sakura", "cherry blossom", "blossom", "florist", "wedding", "beauty", "skincare", "pastry", "delicate"],
    grants: ["tasteful"],
    avoid: "The pink accent as small text (use the text-safe shade); heavy shadows.",
  },
  {
    id: "anime-traditional-kitsune-flix", name: "Kitsune Flix", style: "Traditional Japanese, washi paper and vermilion inkan", file: "10_kitsune_flix_traditional_japanese.html", mode: "light",
    concept: "Washi paper and ink: a vermilion seal, vertical Japanese text, kanji subtitles, refined lines instead of boxes.",
    fonts: { display: "Shippori Mincho", text: "DM Sans", extra: "Noto Sans JP", use: "Shippori Mincho for titles and Japanese text, Noto Sans JP for Japanese UI text, DM Sans for Latin text." },
    tokens: { bg: "#f6f2e9", surface: "#eee8dc", surface2: "#e8dfd1", line: "#d9d0c1", text: "#282724", muted: "#777268", accent: "#a9362d", accent2: "#76271f", onAccent: "#f6f2e9" },
    textSafe: { muted: "#6b665d" },
    radius: "none, except the circular seal",
    blocks: [
      { id: "anime-kitsune-sidebar", name: "Seal sidebar with vertical text", how: "inkan seal and vertical 物語の世界へ text" },
      { id: "anime-kitsune-topbar", name: "Quiet topbar", how: "minimal search and links on paper" },
      { id: "anime-kitsune-featured", name: "Featured with kanji subtitle", how: "title, kanji subtitle and a paper texture" },
      { id: "anime-kitsune-seasonal", name: "Seasonal row with kanji numbering", how: "refined cards numbered in kanji" },
      { id: "anime-kitsune-collection", name: "Philosophy split with seal badge", how: "split section with an authentic seal badge" },
    ],
    layout: "Asymmetric, lots of paper; vertical writing (writing-mode: vertical-rl) as an accent, never for body text.",
    motion: "Slow ink-like fades; nothing bouncy.",
    fits: ["tea house", "cultural exhibit", "museum", "artisanal craft", "ryokan", "calligraphy", "japanese restaurant", "heritage"],
    signals: ["japanese", "traditional", "kanji", "washi", "zen", "tea house", "museum", "heritage", "craft", "artisan", "ryokan", "calligraphy", "kitsune", "temple", "wabi"],
    grants: ["tasteful"],
    avoid: "Fake Japanese (use real, correct Japanese text or none), red everywhere (the seal is the accent).",
  },
  {
    id: "anime-celestial-senpai-plus", name: "Senpai+", style: "Celestial dark luxury streaming", file: "11_senpai_plus_celestial_streaming.html", mode: "dark",
    concept: "A night sky over a premium service: deep navy, violet and silver, a planetary orb, abstract vector art instead of photos, clear tiers.",
    fonts: { display: "Space Grotesk", text: "DM Sans", use: "Space Grotesk 600-700 for headlines and tier names, DM Sans for text and features; tabular numbers for prices." },
    tokens: { bg: "#080d1d", surface: "#111a30", surface2: "#17213a", line: "#2a3550", text: "#f4f6ff", muted: "#9aa7c0", accent: "#a58bff", accent2: "#d9e0f0", onAccent: "#080d1d" },
    radius: "14px cards, 30px pills, round orbs",
    blocks: [
      { id: "anime-senpai-topbar", name: "Celestial topbar", how: "wordmark, links and a membership action" },
      { id: "anime-senpai-hero", name: "Planetary orb hero", how: "vector orb, orbit ring and a figure behind one featured title", looks: ["violet"] },
      { id: "anime-senpai-discover", name: "Vector poster grid", how: "recommendations with abstract vector poster art in eight palettes" },
      { id: "anime-senpai-exclusives", name: "Exclusive premieres band", how: "a wide band with a giant S+ watermark" },
      { id: "anime-senpai-watchlist", name: "My List panel", how: "saved titles with a live counter" },
      { id: "anime-senpai-pricing", name: "Tiered pricing cards", how: "Essential, Plus and Ultra tiers with feature lists and one recommended tier" },
      { id: "anime-senpai-account", name: "Account overview", how: "a public account preview box with plan and usage" },
    ],
    layout: "Hero, then alternating grids and wide bands; pricing as three columns on desktop, stacked on phones.",
    motion: "Calm: a slow orbit, hover lifts on posters; nothing loops under reduced motion.",
    fits: ["premium saas", "subscription platform", "dark mode portal", "membership site", "streaming service", "saas pricing page"],
    signals: ["celestial", "orbit", "planetary", "astral", "subscription tiers", "pricing tiers", "dark luxury", "premium streaming"],
    grants: ["violet", "reflex-type"],
    avoid: "Photographic clutter (the art is abstract vector), more than one glowing orb.",
  },
  {
    id: "anime-community-anime-live", name: "Anime Live", style: "Community watch party, live social platform", file: "12_anime_live_watch_party_community.html", mode: "dark",
    concept: "A watch party: three columns (dock, live feed, activity rail), a LIVE NOW badge with viewer counts, schedules with who is going, chat.",
    fonts: { display: "Space Grotesk", text: "DM Sans", use: "Space Grotesk for titles and counts, DM Sans for chat, feed and labels." },
    tokens: { bg: "#101014", surface: "#1b1b22", surface2: "#22222b", line: "#303039", text: "#f6f4f8", muted: "#9998a7", accent: "#a88aff", accent2: "#ff746f", onAccent: "#101014" },
    radius: "5-12px; round avatars",
    blocks: [
      { id: "anime-live-sidebar", name: "Navigation dock", how: "a left app dock with sections and the user" },
      { id: "anime-live-topbar", name: "Community topbar", how: "breadcrumbs and community search; on phones its menu button opens the navigation dock, which comes with it" },
      { id: "anime-live-intro", name: "Community intro", how: "a short welcome with the next event" },
      { id: "anime-live-party", name: "Live watch-party hero", how: "a LIVE NOW badge, viewer count (1.2k watching) and a join action", looks: ["marquee"] },
      { id: "anime-live-premieres", name: "Premiere schedule", how: "cards with attendee avatar stacks (+348 going) and remind-me buttons" },
      { id: "anime-live-discussions", name: "Discussion feed", how: "posts with tabs (For you, Trending, Fan theories)" },
      { id: "anime-live-rail", name: "Activity rail with live chat", how: "a right rail: chat preview with colour-coded users, popular watchlists (01-03) and friends online", looks: ["numerals"] },
    ],
    layout: "App shell: dock 220-260px, main feed, activity rail 300-340px; the rail drops below the feed under 1100px.",
    motion: "Live but small: a pulsing live dot, new chat lines sliding in; static under reduced motion.",
    fits: ["social community", "creator watch party", "live webinar", "discord-like app", "live events", "online classes", "fan community", "creator platform"],
    signals: ["watch party", "watch-party", "livestream", "live stream", "live chat", "community", "discord", "webinar", "viewers", "chat rail", "watch parties"],
    grants: ["reflex-type", "numerals"],
    avoid: "A chat that hides the main content; fake live numbers presented as real.",
  },
  {
    id: "anime-minimal-swiss-editorial", name: "Minimal Otaku", style: "Ultra-minimal Swiss and brutalist editorial", file: "13_minimal_otaku_swiss_editorial.html", mode: "light",
    concept: "Swiss rigour: white paper, black ink, one red, giant type, a strict grid, numbered buttons, colour only in the posters.",
    fonts: { display: "Space Grotesk", text: "DM Sans", use: "Space Grotesk 700 at very large sizes with tight leading for the hero and numbers, DM Sans for text." },
    tokens: { bg: "#ffffff", surface: "#f5f5f2", surface2: "#ededea", line: "#dededb", text: "#161616", muted: "#777777", accent: "#df452f", accent2: "#161616", onAccent: "#ffffff" },
    textSafe: { muted: "#6f6f6f", accent: "#cd3520" },
    radius: "none; circles only as markers",
    blocks: [
      { id: "anime-minimal-header", name: "Minimal header", how: "a wordmark and plain text links on a rule" },
      { id: "anime-minimal-hero", name: "Giant type hero", how: "one oversized statement (Anime, considered.) and a line of text" },
      { id: "anime-minimal-genres", name: "Numbered genre grid", how: "a 4x2 grid of genre buttons with 01-08 sub-labels", looks: ["numerals"] },
      { id: "anime-minimal-catalog", name: "Colour poster catalog", how: "search with a live count and flat colour posters with angled watermarks" },
      { id: "anime-minimal-manifesto", name: "Manifesto", how: "a statement section (Less scrolling. More discovering.)" },
      { id: "anime-minimal-detail", name: "Slide-in detail with episode list", how: "a detail dialog with stats and an episode guide" },
    ],
    layout: "A 12-column grid with hard rules; asymmetry by type size, not by decoration.",
    motion: "None beyond instant state changes; the detail panel slides in once.",
    fits: ["swiss design portfolio", "brutalist architecture", "design studio", "minimalist blog", "creative agency", "typography portfolio", "architecture firm"],
    signals: ["swiss", "brutalist", "brutalism", "minimalist", "international style", "grid system", "stark", "monochrome", "helvetica"],
    grants: ["reflex-type", "numerals", "eyebrow"],
    avoid: "Shadows, rounded cards and gradients; colour outside the posters and the one red.",
  },
  {
    id: "anime-archive-anime-vault", name: "Anime Vault", style: "Dark heritage archive, studio museum vault", file: "14_anime_vault_heritage_archive.html", mode: "dark",
    concept: "A museum's vault after hours: slate and old gold, catalogue numbers, metadata like museum labels, a dossier for each work.",
    fonts: { display: "Playfair Display", text: "DM Sans", extra: "DM Mono", use: "Playfair Display for titles, DM Mono for catalogue numbers, years and studios, DM Sans for text." },
    tokens: { bg: "#0b1119", surface: "#111b25", surface2: "#17232e", line: "#2b3945", text: "#ece9df", muted: "#9ba8ae", accent: "#c7a86c", accent2: "#e0c58d", onAccent: "#0b1119" },
    radius: "none; a thin gold topline",
    blocks: [
      { id: "anime-vault-header", name: "Heritage header with view switcher", how: "a gold topline, heritage mark and a Discover / My Watchlist switch" },
      { id: "anime-vault-hero", name: "Curated hero with collection index", how: "a curated statement with a 01-08 collection index", looks: ["numerals"] },
      { id: "anime-vault-filters", name: "Facet filter sidebar", how: "search, genre, release period, studio and rating facets" },
      { id: "anime-vault-archive", name: "Archive browser", how: "the facet sidebar with archive cards whose metadata grid lists studio, episodes and genres" },
      { id: "anime-vault-watchlist", name: "Collection status watchlist", how: "Plan to watch, Watching and Completed tabs over saved cards" },
      { id: "anime-vault-dossier", name: "Dossier modal", how: "a work's dossier: Japanese title, synopsis, metadata and its collection status" },
    ],
    layout: "Catalogue rhythm: sidebar 260px plus a card grid; every card carries a label-like metadata block.",
    motion: "Slow fades; the dossier opens without bounce.",
    fits: ["digital archive", "museum collection", "research repository", "university library", "luxury registry", "wine vault", "watch collection", "auction house", "digital library"],
    signals: ["archive", "archival", "heritage", "vault", "registry", "provenance", "repository"],
    grants: ["eyebrow", "numerals"],
    avoid: "Bright colour, playful motion, rounded friendly cards.",
  },
  {
    id: "anime-cyberpop-hyperanime", name: "Hyperanime", style: "Hyper-vibrant cyber-pop, multiverse streaming", file: "15_hyperanime_cyberpop_multiverse.html", mode: "dark",
    concept: "A neon pop multiverse: deep purple-black, hot pink, cyan and orange, a gradient wordmark, glowing tags, rank numerals.",
    fonts: { display: "Space Grotesk", text: "DM Sans", use: "Space Grotesk 700 uppercase for headlines and ranks, DM Sans for text; gradient fill only on the wordmark." },
    tokens: { bg: "#100b20", surface: "#1a1430", surface2: "#211a35", line: "#383049", text: "#fffafc", muted: "#aaa3bc", accent: "#ff4a9b", accent2: "#65eaff", onAccent: "#100b20" },
    radius: "14-22px cards, pills for tags",
    blocks: [
      { id: "anime-hyper-header", name: "Gradient wordmark header", how: "a gradient wordmark with a glowing pulse badge", looks: ["gradient-text"] },
      { id: "anime-hyper-hero", name: "Neon hero with live counter", how: "radial neon glow behind one title and a live watch counter", looks: ["violet", "glass"] },
      { id: "anime-hyper-for-you", name: "For You cards with neon tags", how: "handpicked cards tagged HOT, NEW and TOP PICK", looks: ["violet"] },
      { id: "anime-hyper-trending", name: "Trending with rank numerals", how: "cards over giant 01-03 ranking numerals", looks: ["numerals"] },
      { id: "anime-hyper-releases", name: "New releases list", how: "a horizontal list with episode status pills" },
      { id: "anime-hyper-collections", name: "Dual collection banners", how: "two collection banners side by side" },
    ],
    layout: "Big hero, then sections of cards with strong rank and tag cues; dense and loud, with one calm row per screen.",
    motion: "Glows and quick hover pops; all still under reduced motion.",
    fits: ["web3 gaming", "nft drop", "esports festival", "youth entertainment", "music festival", "streetwear drop", "creator merch"],
    signals: ["cyberpop", "cyber-pop", "hyperpop", "multiverse", "vibrant", "y2k", "holographic", "electric", "neon pop"],
    grants: ["violet", "gradient-text", "glass", "reflex-type", "numerals"],
    avoid: "Gradient text beyond the wordmark; four neon colours in one component.",
  },
];

/**
 * Words that make a request anime or entertainment work (the archetypes' home ground). Only
 * unambiguous ones: "series" (time series), "show", "media", "season" and "film" mean other things too.
 */
export const ENTERTAINMENT_WORDS = [
  "anime", "manga", "manhwa", "webtoon", "donghua", "otaku", "cosplay", "vtuber", "fandom", "fan site", "fansite", "streaming site", "streaming platform",
  "watchlist", "watch list", "episode guide", "episodes", "k-drama", "kdrama", "tv show", "tv series", "movies", "cinema", "anime club", "studio ghibli",
  "light novel", "visual novel", "j-pop", "jpop", "idol group", "entertainment site", "entertainment platform", "watch party", "watch parties",
];
