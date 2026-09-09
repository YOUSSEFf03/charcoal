import { StyleSheet, Text, View } from 'react-native';
import type { ContainerStatus } from '../api/types';
import { STATUS_COLOR, STATUS_LABEL } from '../utils/status';

export function StatusBadge({ status }: { status: ContainerStatus }) {
  const color = STATUS_COLOR[status];
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1A`, borderColor: `${color}40` }]}>
      <Text style={[styles.text, { color }]}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

/** Raw provider tracking status (e.g. "IN_TRANSIT") — shown verbatim, matching the web app's convention. */
export function TrackingStatusBadge({ status }: { status: string }) {
  return (
    <View style={[styles.badge, styles.grayBadge]}>
      <Text style={[styles.text, styles.monoText]}>{status}</Text>
    </View>
  );
}

export function DelayBadge() {
  return (
    <View style={[styles.badge, { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' }]}>
      <Text style={[styles.text, { color: '#B91C1C' }]}>Delayed</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  grayBadge: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
  },
  text: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  monoText: {
    fontFamily: 'monospace',
    color: '#475569',
  },
});
