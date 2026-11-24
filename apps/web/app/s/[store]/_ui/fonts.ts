// Store typefaces (template rebuild, 22 Nov 2026). Self-hosted at build time by next/font: no request to Google from the shopper's browser.
// preload: false, so a shop only downloads the two files its template actually uses. Variable names must match TYPE_PAIRS in
// lib/aimp/storefront/templates.ts (a test checks this).
import {
  Archivo, Bricolage_Grotesque, Cormorant_Garamond, DM_Sans, DM_Serif_Display, Epilogue, Figtree, Fraunces, Fredoka, Gloock, Instrument_Sans,
  Instrument_Serif, Karla, Libre_Caslon_Text, Manrope, Mulish, Nunito, Nunito_Sans, Rubik, Schibsted_Grotesk, Sora, Syne, Unbounded, Work_Sans, Young_Serif,
} from 'next/font/google';

// next/font needs literal options in each call (no shared object or spread).
const bricolage = Bricolage_Grotesque({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-bricolage' });
const fraunces = Fraunces({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-fraunces', axes: ['SOFT', 'opsz'] });
const workSans = Work_Sans({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-worksans' });
const youngSerif = Young_Serif({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--stf-youngserif' });
const figtree = Figtree({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-figtree' });
const syne = Syne({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-syne' });
const manrope = Manrope({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-manrope' });
const caslon = Libre_Caslon_Text({ subsets: ['latin'], display: 'swap', preload: false, weight: ['400', '700'], style: ['normal', 'italic'], variable: '--stf-caslon' });
const karla = Karla({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-karla' });
const unbounded = Unbounded({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-unbounded' });
const rubik = Rubik({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-rubik' });
const archivo = Archivo({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-archivo', axes: ['wdth'] });
const gloock = Gloock({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--stf-gloock' });
const schibsted = Schibsted_Grotesk({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-schibsted' });
const instrumentSerif = Instrument_Serif({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', style: ['normal', 'italic'], variable: '--stf-instrumentserif' });
const instrumentSans = Instrument_Sans({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-instrumentsans' });
const fredoka = Fredoka({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-fredoka' });
const nunitoSans = Nunito_Sans({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-nunitosans' });
const dmSerif = DM_Serif_Display({ subsets: ['latin'], display: 'swap', preload: false, weight: '400', variable: '--stf-dmserif' });
const dmSans = DM_Sans({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-dmsans' });
const nunito = Nunito({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-nunito' });
const cormorant = Cormorant_Garamond({ subsets: ['latin'], display: 'swap', preload: false, weight: ['400', '500', '600', '700'], variable: '--stf-cormorant' });
const mulish = Mulish({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-mulish' });
const sora = Sora({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-sora' });
const epilogue = Epilogue({ subsets: ['latin'], display: 'swap', preload: false, variable: '--stf-epilogue' });

/** Every store typeface variable as one className for the .st root. */
export const storeFontVars = [
  bricolage, fraunces, workSans, youngSerif, figtree, syne, manrope, caslon, karla, unbounded, rubik, archivo, gloock, schibsted,
  instrumentSerif, instrumentSans, fredoka, nunitoSans, dmSerif, dmSans, nunito, cormorant, mulish, sora, epilogue,
].map((f) => f.variable).join(' ');
