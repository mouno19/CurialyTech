# Curialy component library

One registry for every reusable component the agent can compose into interfaces: charts and data
visualization, dashboard and analytics blocks, navigation, tables, and whatever is added later.
Categories and batches are searchable metadata, not limits: a request is planned across all of them.

```
component-library/
├── components/<id>/          one folder per component (registered by being here)
│   ├── component.json        metadata (schema: server/components/registry.ts, componentSchema)
│   ├── react.jsx | component.html   the implementation(s) it lists
│   └── preview.html          a standalone page that renders it (render checks, people)
├── tokens/<id>.json          design token sets (one per visual family): colour roles, fonts, radius
├── styles/<id>.css           a family's shared stylesheet (scoped to .cx-<id>)
├── vocabulary.json           concepts the search understands, and kinds of products and their parts
└── atlas/                    the staged Component Atlas sources (imported by scripts/components)
```

## How the agent uses it

1. `find_components(request, needs?)` — intent (kind of product, the needs named and implied, a dark
   or light look, the relevant tools) → a hybrid search of the whole registry for every need → one
   plan: a component per need (or "build" when nothing fits, never an unrelated one), a pattern
   covering its parts, one design theme, the layout regions, and the packages, stylesheets and
   component dependencies resolved to one version each. Metadata only: no source is read.
2. `add_components(ids, theme?)` — copies the chosen components into the workspace with their
   colours adapted to the theme (by role), their stylesheets, and `tokens.css` / `tokens.js` for
   everything built around them. The source never passes through the model's context.
3. `load_component(id)` — reads one component when the agent needs to see it.
4. `save_component(path, …)` — keeps something the agent built as a **candidate** for that account's
   later tasks (stored in `curialy.component_candidates`; other accounts never see it).

The tools the user selects for a task (Web Design, Data Analytics, Dashboard Builder, UI/UX Design,
Frontend Development, Backend Development; none: not limited) limit what is used: a need whose
components belong to an unselected tool is reported, and the agent asks the user to enable it.

## Registering a component

Add a folder `components/<id>/` with a `component.json` and the files it lists. The id must match
the folder name (lowercase letters, digits, dashes). The registry notices within seconds; no code,
vocabulary or orchestration change is needed. Minimal example:

```json
{
  "id": "table-order-book",
  "name": "Order book",
  "description": "Live bids and asks with depth bars, for trading terminals.",
  "category": "data-management",
  "batch": "trading",
  "role": "table",
  "tags": ["order-book", "bids", "asks", "trading"],
  "capabilities": ["responsive", "keyboard"],
  "dependencies": [{ "type": "package", "name": "react", "version": "18.3.1" }, { "type": "tokens", "id": "atlas-terminal" }],
  "compatible_tools": ["data-analytics", "dashboard-builder", "frontend-development"],
  "frameworks": ["react"],
  "implementations": [{ "framework": "react", "file": "react.jsx" }],
  "layout": { "role": "table", "span": "full" },
  "style": { "tokens": "atlas-terminal", "mode": "dark", "colors": { "#60e6b2": "positive", "#ff7782": "negative" } },
  "status": "active"
}
```

- `style.colors` maps the component's colours to token roles; that is what lets it take another
  family's theme. Colours left out stay as they are.
- `variant_of` marks another implementation of the same component (one per group is used);
  `composes` lists the components a pattern already contains.
- A folder that doesn't validate is skipped and reported (`registry().problems`), never fatal.
- To teach the search new words, add terms or concepts to `vocabulary.json`.

## The anime style archetypes

`anime-templates/` holds ten complete anime and entertainment site templates. They are the source
of the design intelligence's style archetypes (server/agent/design/knowledge/archetypes.ts) and of
54 blocks registered here (`anime-*`, with `archetype` set): headers, heroes, shelves, filter
sidebars, episode guides, streak trackers, critics' scores, seals and more. A design mixes blocks of
several archetypes on one token set (`tokens/anime-*.json`); a whole template is never reproduced.
After changing archetypes.ts run `node node_modules/tsx/dist/cli.mjs scripts/components/export-archetypes.mts`,
then the importer.

## The imported Component Atlas

`node scripts/components/import-atlas.mjs` turns `atlas/*.html` into components (configuration in
`scripts/components/families.mjs`): the 100 graphs (file 01 holds a second implementation of
021–030, registered as `-alt` variants) and the analytics blocks of file 10. It removes what only
the authoring tool needed, fixes a syntax error in file 01, and writes the token sets.
`node scripts/components/render-check.mjs` renders every preview in a cloud browser and records
the result in each component.json (`quality.rendered`); a component that didn't render is marked
`needs-review` and ranks lower.
