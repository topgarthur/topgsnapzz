export function phoneBrowser() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(max-width: 900px) and (pointer: coarse)').matches;
  }
  return false;
}
