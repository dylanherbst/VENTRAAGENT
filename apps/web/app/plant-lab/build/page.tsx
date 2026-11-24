import type { Metadata } from 'next';
import { site } from '../../../lib/aimp/site-config';
import '../tokens.css';
import '../../s/[store]/store.css';
import './build.css';
import { fontVars } from '../fonts';
import { BuildFlow } from './build-flow';
import { parseFlowState } from './state';

export const metadata: Metadata = {
  title: 'Build your business preview',
  description: `See a sample digital-product business from ${site.name} before you sign up.`,
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function BuildPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const initial = parseFlowState((key) => {
    const v = sp[key];
    return Array.isArray(v) ? v[0] : v;
  });
  return (
    <div className={`amp bp ${fontVars}`}>
      <header className="bp-top">
        <div className="bp-wrap bp-top-inner">
          <a className="bp-logo" href="/plant-lab">{site.name}</a>
          <a className="bp-top-link" href="/workspace">Sign in</a>
        </div>
      </header>
      <BuildFlow initial={initial} />
    </div>
  );
}
