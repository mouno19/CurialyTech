package: @curialy/ui

# useImageMode

Detects whether an image is predominantly dark or light by sampling pixels via OffscreenCanvas. Uses APCA perceptual lightness (sRGB linearization + power curve) for accurate detection, especially on saturated colors. Runs entirely off the paint path: no visible canvas, no layout thrash. Supports regional sampling for detecting luminance where text overlays will appear. Returns null while loading and falls back gracefully on CORS or network errors.

## Best Practices

- **Do:** Pair with MediaTheme to automatically adapt text color over dynamic background images.
- **Do:** Use the region option to sample only the area where text overlays will appear for more accurate results.
- **Don't:** Use for images that change rapidly (e.g., video frames); each src change triggers a new fetch and analysis.

## Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `src` | `string \| null \| undefined` | - | Image source URL to analyze. When null/undefined, returns the fallback value. **(required)** |
| `options` | `UseImageModeOptions` | - | Optional configuration for image analysis. |
| `options.region` | `ImageSampleRegion` | - | Region to sample within the image using normalized 0-1 coordinates ({ x, y, width, height }). Defaults to the full image. |
| `options.threshold` | `number` | `0.5` | Luminance threshold for the dark/light split. Below = dark, above = light. |
| `options.fallback` | `'dark' \| 'light' \| null` | `null` | Fallback value while loading or on error. |

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `mode` | `'dark' \| 'light' \| null` | Detected luminance mode of the image. Returns null while loading or if src is null/undefined. |


Block templates: design_system component <name> --blocks for MediaTheme
