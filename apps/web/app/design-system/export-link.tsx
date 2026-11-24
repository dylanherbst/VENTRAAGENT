'use client';
import Link from 'next/link';
import { OutlineIcon } from './primitives';
import { useWorkspace } from '../ui/ventra-context';

/** Outlined header button. Shown only once the business is set up. The real "Download my data" export lives in Settings, so this opens it. */
export function ExportLink() {
  const { profile } = useWorkspace();
  if (!profile) return null;
  return <Link className="v-button v-export" href="/settings"><OutlineIcon name="share" />Export</Link>;
}
