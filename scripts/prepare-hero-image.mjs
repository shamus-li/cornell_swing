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

await Promise.all(
  widths.map(async (width) => {
    const filename =
      slot === 1 ? `hero-${width}.webp` : `hero-${slot}-${width}.webp`
    const outputPath = path.join(assetDirectory, filename)

    await sharp(sourcePath)
      .rotate()
      .resize({
        width,
        height: Math.round((width * 2) / 3),
        fit: "cover",
        position: "attention",
      })
      .webp({ quality: 82 })
      .toFile(outputPath)
  }),
)

console.log(`Updated hero image ${slot} from ${sourcePath}`)
