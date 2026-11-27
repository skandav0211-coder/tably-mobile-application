export interface ResponsiveLayout {
  width: number;
  height: number;
  landscape: boolean;
  rail: boolean;
  railWidth: number;
  twoPane: boolean;
  cartWidth: number;
  compact: boolean;
  pad: number;
}

export function responsiveLayout(width: number, height: number): ResponsiveLayout {
  const landscape = width > height;
  const rail = width >= 720 || (landscape && width >= 500);
  const twoPane = width >= 960 || (landscape && width >= 640);
  const railWidth = landscape ? 80 : 92;
  const cartWidth = Math.min(420, Math.max(240, width * 0.36));
  const compact = landscape && height < 520;
  return {
    width, height, landscape, rail, railWidth, twoPane, cartWidth, compact,
    pad: compact ? 12 : width >= 720 ? 24 : 16,
  };
}
