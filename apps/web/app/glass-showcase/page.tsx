// Glass showcase: the real Liquid Glass React component (rdev/liquid-glass-react), compared on a photo and on VENTRA's light
// background, with a temporary settings panel. Tailwind preflight is scoped to this page (.glasscn-original) as the
// library's demo runs with preflight. Temporary, for review on branch ui/lab.
import LiquidGlassLab from './liquid-glass-lab';
import './glasscn-original.css';
import './lgr.css';

export default function GlassShowcase() {
  return <div className="glasscn-original"><LiquidGlassLab /></div>;
}
