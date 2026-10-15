/** Where the seal lives, once, so nothing has to remember the path. */
const LOGO_SRC = '/brand/nca-logo.png';

/**
 * The Authority's seal, wherever the portal says who it belongs to.
 *
 * One component rather than an `img` in each place, because the whole point of the exercise was
 * that the sign-in screen, the shell, the printed sheet and the browser tab had each arrived at
 * their own idea of what this portal looks like - three of them a generic shield icon, and the
 * tab nothing at all.
 *
 * The file is cut to the circle with a transparent ground, so it sits on the navy sidebar without
 * a white box behind it.
 *
 * Decorative by default. Everywhere the mark appears the Authority's name is written beside it,
 * and a screen reader announcing the seal before reading that same name is noise. Pass `alt` only
 * where it stands on its own.
 */
export function BrandMark({
  size = 36,
  alt = '',
  className = '',
}: {
  size?: number;
  alt?: string;
  className?: string;
}) {
  return (
    <img
      src={LOGO_SRC}
      alt={alt}
      width={size}
      height={size}
      decoding="async"
      // Fixed both ways: the seal is square, and a box that sizes itself makes the shell jump
      // while the image is still arriving.
      style={{ width: size, height: size }}
      className={`shrink-0 ${className}`}
    />
  );
}
