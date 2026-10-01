import path from "node:path"

import sharp from "sharp"

const [slotValue, sourceValue] = process.argv.slice(2)
const slot = Number(slotValue)

if (!Number.isInteger(slot) || slot < 1 || slot > 4 || !sourceValue) {
  console.error("Usage: npm run hero:image -- <slot 1-4> <image path>")
  process.exit(1)
}

const sourcePath = path.resolve(sourceValue)
const assetDirectory = path.resolve("assets")
const widths = slot === 1 ? [480, 720, 960, 1800] : [480, 720, 960, 1600]

const resized = (width) =>
  sharp(sourcePath)
    .rotate()
    .resize({
      width,
      height: Math.round((width * 2) / 3),
      fit: "cover",
      position: "attention",
    })

await Promise.all(
  widths.map(async (width) => {
    const filename =
      slot === 1 ? `hero-${width}.avif` : `hero-${slot}-${width}.avif`
    await resized(width)
      .avif({ quality: 55 })
      .toFile(path.join(assetDirectory, filename))
  }),
)

// Link previews use WebP because some social platforms cannot read AVIF.
if (slot === 1) {
  await resized(960).webp({ quality: 82 }).toFile(path.join(assetDirectory, "hero-960.webp"))
}

console.log(`Updated hero image ${slot} from ${sourcePath}`)
