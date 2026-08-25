export interface ParticipantLabelOptions {
  isHost?: boolean;
  isLocal?: boolean;
  isSharing?: boolean;
}

export function formatParticipantLabel(name: string, options: ParticipantLabelOptions = {}) {
  const labels = [name];
  if (options.isHost && name.trim().toLowerCase() !== 'host') labels.push('Host');
  if (options.isLocal) labels.push('You');
  if (options.isSharing) labels.push('Sharing');
  return labels.join(' · ');
}
