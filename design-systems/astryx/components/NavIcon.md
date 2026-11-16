package: @astryxdesign/core

# NavIcon

NavIcon is a circular icon container with an accent-colored background. Use it in navigation headers such as TopNavHeading and PageNavHeader to visually identify a section or application.

**Import:** `import {NavIcon} from '@astryxdesign/core/NavIcon';`

## Anatomy

| Element | Required | Description |
|---------|----------|-------------|
| Container | Yes | Circular painted container for the supplied icon. |
| Icon | Yes | Caller-supplied visual content rendered inside the container. |

## Best Practices

- **Do:** Use in navigation headers to provide a recognizable visual anchor for the section.
- **Do:** Pass an Icon or similarly sized icon component to ensure proper proportions.
- **Don't:** Use NavIcon for interactive purposes; it is a display-only container, not a button.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `icon` | `ReactNode` | - | Icon element inside circular background. Should be Icon or similar. **(required)** |

## Theming

| Component class | Preferred data attributes | Props | States |
|-----------------|---------------------------|-------|--------|
| `astryx-nav-icon` | - | - | - |

Override in defineTheme:
```ts
components: {
  'nav-icon': {
    base: { /* CSS properties */ },
  },
}
```
