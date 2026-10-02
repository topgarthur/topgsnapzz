function releaseBitmap(bitmap) {
  if (bitmap && typeof bitmap.close === 'function') bitmap.close();
}

export function orientBitmap(bitmap, orientation) {
  if (!orientation || orientation === 1) return bitmap;
  const width = bitmap.width;
  const height = bitmap.height;
  const swapped = orientation > 4;
  const canvas = new OffscreenCanvas(swapped ? height : width, swapped ? width : height);
  const ctx = canvas.getContext('2d');
  switch (orientation) {
    case 2:
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      break;
    case 3:
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      break;
    case 4:
      ctx.translate(0, height);
      ctx.scale(1, -1);
      break;
    case 5:
      ctx.rotate(Math.PI / 2);
      ctx.scale(1, -1);
      break;
    case 6:
      ctx.rotate(Math.PI / 2);
      ctx.translate(0, -height);
      break;
    case 7:
      ctx.rotate(Math.PI / 2);
      ctx.translate(width, -height);
      ctx.scale(-1, 1);
      break;
    case 8:
      ctx.rotate(-Math.PI / 2);
      ctx.translate(-width, 0);
      break;
    default:
      break;
  }
  ctx.drawImage(bitmap, 0, 0);
  const oriented = canvas.transferToImageBitmap();
  releaseBitmap(bitmap);
  return oriented;
}
