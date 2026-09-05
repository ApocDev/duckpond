# Duckpond avatar study

One illustrated base duck, with hats and clothing for different agents. This directory preserves the source artwork and prompts. The application serves copies of the finished PNGs from `public/brand/`.

## Files

- `base.png` is the identity reference for every outfit.
- `explorer.png`, `detective.png`, `builder.png`, and `wizard.png` are complete dressed avatars, not separate clothing layers.
- `prompts/base.txt` contains the exact base-generation prompt.
- `prompts/outfit-template.txt` contains the reusable outfit prompt. Replace `{{OUTFIT_DESCRIPTION}}` with the hat and clothing description.
- The four named prompt files contain the exact outfit prompts.
- `sources/` preserves the outfit generations before background removal.
- `prompts/remove-background.txt` contains the exact transparency correction prompt.
- `manifest.json` records the reference images, prompts, and output files.
- `index.html` previews the artwork and small avatar sizes on dark and amber backgrounds.

## Generate another outfit

1. Use `base.png` as the image-edit reference. Start every outfit from this file, not from a dressed variant.
2. Read `prompts/outfit-template.txt` and replace the outfit placeholder. Describe only the hat and clothing. Keep the duck's face, proportions, pose, palette, framing, and drawing style consistent.
3. Use the built-in image generation tool with the edited prompt and `base.png` as `referenced_image_paths`. This set uses the built-in tool; it does not specify an API model or reproducible seed.
4. Save the result and exact prompt under a new descriptive outfit name. Record its reference and any correction steps in `manifest.json`.
5. Inspect the PNG's alpha channel. A drawn checkerboard is not transparency. If needed, edit the result with `prompts/remove-background.txt` and preserve the input in `sources/`.
6. Check the avatar at 32, 48, and 64 pixels on a dark background. Keep eyes and bill visible and use a large, recognizable hat shape.

Image edits can change small details and framing even with a saved reference. Compare each result with `base.png`; prompts do not guarantee pixel-identical anatomy. Save a different base design in a separate version directory rather than overwriting this one.

These outfits are examples. They are not tied to a fixed roster or provider. The yellow duck is the shared character; clothing distinguishes the individual agent.
