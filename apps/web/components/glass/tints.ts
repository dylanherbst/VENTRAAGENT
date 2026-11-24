// Colour washes for Liquid Glass cards (translucent so the refraction still shows through).
export const GRAPE = 'linear-gradient(170deg, rgba(118,51,92,0.434) 0%, rgba(165,146,238,0.385) 48%, rgba(254,134,170,0.42) 100%)';
export const SLATE = 'linear-gradient(170deg, rgba(40,52,64,0.385) 0%, rgba(83,104,120,0.315) 100%)';
// Toasts float over busy content, so they get a denser wash.
export const TOAST = 'linear-gradient(170deg, rgba(24,30,40,0.574) 0%, rgba(50,62,74,0.546) 100%)';

export const TINTS = { grape: GRAPE, slate: SLATE, toast: TOAST, clear: undefined } as const;
export type Tint = keyof typeof TINTS;
