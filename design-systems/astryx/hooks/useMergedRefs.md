package: @astryxdesign/core

# useMergedRefs

Combines multiple object or callback refs into one stable callback ref. Use it when a component must forward a consumer ref while also attaching internal refs. Unlike calling mergeRefs during render, the callback identity stays stable across unrelated rerenders, so React does not detach and reattach the element.

## Best Practices

- **Do:** Use useMergedRefs when one element must receive both a forwarded ref and one or more internal refs.
- **Don't:** Call mergeRefs directly in a JSX ref prop; that creates a new callback on every render and forces unnecessary detach and attach work.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `refs` | `Array<Ref<T> \| undefined>` | - | Up to six refs that should all receive the same element. **(required)** |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `ref` | `RefCallback<T>` | A merged callback ref that remains stable until an input ref changes. |
