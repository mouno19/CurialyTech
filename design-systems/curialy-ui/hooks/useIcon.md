package: @curialy/ui

# useIcon

Resolves a semantic icon name to a React node through the nearest Theme, so a custom component draws the same success, warning or error icon that Curialy UI components draw and follows a theme that overrides it. Resolution reads the nearest Theme's icons (outside any Theme, the registered theme the document root names), then registerIcons() overrides, then the built-in default. The node is returned as is, with no size or color wrapper: the built-in icons are 1em squares in currentColor, so they follow the surrounding text. A function entry is read at {size: 'md'}. Render <Icon icon={name} /> instead when the icon needs another size, a color or a label.

## Best Practices

- **Do:** Use it in a custom component that places a semantic icon itself, so a Theme that overrides the icon changes the component too.
- **Do:** Render <Icon icon={name} /> when the icon needs a size other than md, a color, or an accessible label.
- **Don't:** Import a specific icon library glyph for a semantic purpose that a theme should control, such as a success or error state.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `IconName \| NamespacedIconName` | - | Semantic icon name, such as 'success', 'warning' or 'close', or a namespaced extension key such as 'richtext:bold'. Both resolve through the same registry. **(required)** |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `icon` | `ReactNode` | The icon for that name from the nearest Theme's icons (or, outside any Theme, from the registered theme the document root names), else from registerIcons() overrides, else the built-in default. A function entry is read at {size: 'md'}. |


Block templates: design_system component <name> --blocks for Icon, Theme
