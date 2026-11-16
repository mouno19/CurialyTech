package: @astryxdesign/core

# Icon

Icons are small visual symbols that represent actions, objects, or concepts. They improve scannability and reinforce meaning alongside text. Supports both direct SVG components and semantic icon names that adapt to the active theme.

**Import:** `import {Icon} from '@astryxdesign/core/Icon';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Glyph | Yes | Visual symbol rendered for the selected icon. |

## Best Practices

- **Do:** Use semantic icon names when available; they adapt to theme changes automatically.
- **Do:** Override icons via theme, not globally: defineTheme({icons: {close: <XMarkIcon />}}) scopes the swap to the active <Theme>; extends shallow-merges into derived themes. registerIcons() mutates a global registry and warns in dev: app bootstrap only, not a library theming seam.
- **Do:** Size-aware artwork: a theme/registered entry may be a pure sync function of {size, variant}, e.g. info: ({size}) => <InfoIcon weight={size === 'sm' ? 'bold' : 'regular'} />. Icon passes its rendered size; getIcon/useIcon/getIconRegistry/theme.icons read it at md. A null result draws nothing (no fallback). No hooks, DOM measurement, or browser/mutable state.
- **Do:** Pair icons with text labels for accessibility; icon-only elements need an accessible label.
- **Do:** For a meaningful standalone icon (no adjacent text), set an accessible name via `label`: sets role="img" + aria-label, unhides icon.
- **Do:** Use color tokens for icon colors, not hardcoded hex values.
- **Do:** Be mindful of context; decorative icons in compact components can distract rather than help.
- **Don't:** Use icons as the sole means of conveying meaning; always provide a text alternative.
- **Don't:** Resize icons with arbitrary pixel values; use the provided size props.
- **Don't:** Mix icon styles (e.g. outline and filled) within the same context.
- **Don't:** Render raw SVG elements; always wrap in Icon for consistent sizing and color.
- **Don't:** `name` prop, which does not exist. Use `icon` to specify which icon to render.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `icon` | `IconName \| NamespacedIconName \| ComponentType<SVGProps>` | - | Semantic icon name or SVG component. Valid names: close, chevronDown, chevronLeft, chevronRight, chevronsLeft, chevronsRight, check, success, error, warning, info, calendar, clock, externalLink, menu, moreHorizontal, search, upload, arrowUp, arrowDown, arrowsUpDown, funnel, eyeSlash, viewColumns, copy, checkDouble, wrench, stop, microphone. A namespaced key (`richtext:bold`) names a glyph a component or library registers; an unregistered one renders nothing. For others, pass an SVG component. **(required)** |
| `color` | `'primary' \| 'secondary' \| 'tertiary' \| 'disabled' \| 'accent' \| 'info' \| 'success' \| 'error' \| 'warning' \| 'inherit' \| 'blue' \| 'red' \| 'green' \| 'gray' \| 'cyan' \| 'teal' \| 'yellow' \| 'orange' \| 'pink' \| 'purple'` | `'inherit'` | Color variant mapped to Astryx icon color tokens; inherit = surrounding text color. Web also accepts the non-semantic palette: blue, red, green, gray, cyan, teal, yellow, orange, pink, purple. |
| `size` | `'xsm' \| 'sm' \| 'md' \| 'lg'` | `Contextual; otherwise 'md'` | xsm/sm/md/lg = 12/16/20/24px at a 16px root, scale w/ root font size; theme sets a size's glyph dimension via width + height (px or rem) on components.icon['size:sm'] etc. Explicit Icon size; otherwise nearest owning-component default, then 'md' when no contextual default exists |
| `variant` | `IconVariant` | - | Requests the active theme's alternate artwork (e.g. 'filled'); names from augmentable IconVariantMap. Reaches the entry only if the active theme's iconVariants lists it (and an inherited entry's defining theme does too); else normal artwork. Ignored by a directly passed component; never in the DOM; no theming selector. |
| `label` | `string` | - | Accessible name for a meaningful, standalone icon. Sets role="img" + aria-label and drops the default aria-hidden. Omit (default) for decorative icons (stays aria-hidden). Empty string = decorative. The accessible-name/alt-text prop for icons. |
| `xstyle` | `StyleXStyles` | - | StyleX styles (color, size, opacity) via stylex.create(); composes with the base color/size styles. |
| `className` | `string` | - | Class added to the rendered glyph beside astryx-icon. |
| `style` | `CSSProperties` | - | Inline styles merged after Icon's size and color styles. |
| `ref` | `Ref<SVGSVGElement>` | - | Reaches the rendered SVG for every icon value; null when a resolved glyph has no <svg>. |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-icon` | `data-color`, `data-size` | color, size | - |

Override in defineTheme:
```ts
components: {
  'icon': {
    base: { /* CSS properties */ },
    'color:value': { /* variant-specific */ },
  },
}
```

Some properties are set via standard CSS in component overrides:
```ts
components: {
  icon: {
    base: {
      width: '...',
      height: '...',
    },
  },
}
```
