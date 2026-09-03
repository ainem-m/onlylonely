export function histogramGeometry(count, maxCount) {
  const maximum = Math.max(1, Number(maxCount) || 0);
  const value = Math.min(maximum, Math.max(0, Number(count) || 0));
  const height = Math.round(value / maximum * 10000) / 100;
  return { height, y: 100 - height };
}
