import type { Metadata } from 'next';
import { BrandView } from './brand-view';

export const metadata: Metadata = { title: 'Your brand' };

// Business name, tone, colours and listing wording for the chosen idea: the real brand generator, validation and
// approval flow (the same calls as /tools/aimp-branding), on the glass library.
export default function StartBrand() {
  return <BrandView />;
}
