import { showCharacterCount } from "@/lib/char-count";

/**
 * Shows `n/max` under a length-limited input once it nears the limit, so users
 * know why the browser stops accepting characters (the native maxLength cutoff
 * is silent). Informational only, hence hidden from assistive technology.
 */
export function CharacterCounter({
  value,
  max,
}: {
  value: string;
  max: number;
}) {
  if (!showCharacterCount(value.length, max)) return null;
  return (
    <p aria-hidden="true" className="text-right text-xs text-muted-foreground">
      {value.length}/{max}
    </p>
  );
}
