import 'flag-icons/css/flag-icons.min.css';
import { nationalityCode } from '../lib/nationality';

/** Flag for a nationality ("Indian", "India"); nothing when the nationality isn't recognised. */
export function Flag({ nationality, className = '' }: { nationality?: string; className?: string }) {
  const code = nationalityCode(nationality);
  if (!code) return null;
  return <span className={`fi fi-${code} flag ${className}`} role="img" aria-label={`${nationality} flag`} title={nationality} />;
}
