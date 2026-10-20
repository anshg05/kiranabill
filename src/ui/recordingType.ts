// KB-346 (D90): the media type of a finished recording. The browser's own answer is kept (Chrome: audio/webm;codecs=opus,
// Safari: audio/mp4;codecs=mp4a.40.2 - WebKit writes MP4/AAC, and WebM too from Safari 18.4). An EMPTY answer is possible on
// Safari; left empty the server would label the audio ".webm" and Groq would refuse an mp4 under that name - so name the
// format Safari actually writes. Groq accepts mp4, m4a and webm.

const isWebKitNotChrome = (ua: string): boolean => /iPhone|iPad|iPod/.test(ua) || (/Safari/.test(ua) && !/Chrome|Chromium|Android|Edg|OPR/.test(ua));

export function recordedMimeType(reported: string, userAgent: string): string {
  if (reported) return reported;
  return isWebKitNotChrome(userAgent) ? "audio/mp4" : "audio/webm";
}
