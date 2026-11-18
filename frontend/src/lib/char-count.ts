/** Show a character counter once an input is this fraction of the way to its limit. */
export const CHARACTER_COUNT_THRESHOLD = 0.8;

export function showCharacterCount(length: number, max: number): boolean {
  return length >= max * CHARACTER_COUNT_THRESHOLD;
}
