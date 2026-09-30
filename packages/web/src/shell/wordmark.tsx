import { Link } from '@tanstack/react-router';
import { Wordmark as BrandWordmark } from '@/ui/brand-mark';

/** The product name, linking home. */
export function Wordmark() {
  return (
    <BrandWordmark asChild>
      <Link to="/" aria-label="Ogden Agents, home" />
    </BrandWordmark>
  );
}
