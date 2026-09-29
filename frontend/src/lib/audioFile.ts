/** Extensions worth trying when the browser reports no MIME type, as some systems do for FLAC. */
const AUDIO_EXTENSIONS = /\.(mp3|wav|wave|flac|ogg|oga|opus|m4a|aac|aif|aiff|webm)$/i;

/**
 * Whether a picked or dropped file looks like audio, checked before spending an upload on it.
 * The decoder has the final word; this only stops an obviously wrong drop early.
 */
export function isAudioFile(file: { name: string; type: string }): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name);
}
