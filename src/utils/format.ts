// Distance: meters under 1km, one decimal place in km above that -
// matches how Google Maps formats walking distances.
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// Duration: shows the two largest non-zero units (days+hours, hours+min, or
// just minutes) rather than collapsing everything to minutes, so a
// multi-hour or multi-day walk reads sensibly instead of as "142 min".
export function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    const dayLabel = `${days} day${days === 1 ? '' : 's'}`;
    return hours > 0 ? `${dayLabel} ${hours} hr` : dayLabel;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
  }
  return `${minutes} min`;
}
