import { canvasSurface } from './canvas.js'

// The overlay the app shows over the document, of what the items' `onDraw`
// and `onDrawSelection` handlers draw: `project.draw()` into a canvas of the
// view's size in device pixels, as a browser's view draws, with `matrix` from
// the document to the view.

let overlay = null

// The pixels the handlers drew, as the slot of the canvas, or as `ImageData`
// in a browser's realm, whose canvases have no slots; null when nothing in the
// project draws.
export function drawOverlay(project, matrix, width, height, pixelRatio) {
  if (!project.hasDrawHandlers()) {
    overlay = null
    return null
  }
  width = Math.round(width * pixelRatio)
  height = Math.round(height * pixelRatio)
  if (overlay?.width !== width || overlay.height !== height) {
    overlay = new OffscreenCanvas(width, height)
  }
  const ctx = overlay.getContext('2d')
  ctx.save()
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.scale(pixelRatio, pixelRatio)
    project.draw(ctx, matrix, pixelRatio)
  } finally {
    ctx.restore()
  }
  return canvasSurface(overlay) ?? ctx.getImageData(0, 0, width, height)
}
