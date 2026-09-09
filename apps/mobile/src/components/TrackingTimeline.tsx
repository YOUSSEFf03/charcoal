import { StyleSheet, Text, View } from 'react-native';
import type { MobileTrackingEvent } from '../api/types';
import { formatDateTime } from '../utils/format';

/**
 * The events prop must already be in the desired display order — the
 * backend returns oldest-first; the caller decides whether to reverse it.
 */
export function TrackingTimeline({ events }: { events: MobileTrackingEvent[] }) {
  if (events.length === 0) {
    return <Text style={styles.empty}>No tracking events yet.</Text>;
  }

  return (
    <View style={styles.list}>
      {events.map((ev, i) => (
        <View key={`${ev.occurredAt ?? 'unknown'}-${i}`} style={styles.row}>
          <View style={styles.dotColumn}>
            <View style={styles.dot} />
            {i < events.length - 1 ? <View style={styles.line} /> : null}
          </View>
          <View style={styles.content}>
            <Text style={styles.description}>{ev.description}</Text>
            <Text style={styles.meta}>
              {[ev.location, ev.occurredAt ? formatDateTime(ev.occurredAt) : null].filter(Boolean).join(' · ') ||
                '—'}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  dotColumn: {
    alignItems: 'center',
    width: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1D4ED8',
    marginTop: 4,
  },
  line: {
    width: 2,
    flex: 1,
    backgroundColor: '#E2E8F0',
    marginTop: 2,
  },
  content: {
    flex: 1,
    paddingBottom: 14,
  },
  description: {
    fontSize: 13,
    fontWeight: '500',
    color: '#0F172A',
  },
  meta: {
    fontSize: 11.5,
    color: '#94A3B8',
    marginTop: 2,
  },
  empty: {
    fontSize: 13,
    color: '#94A3B8',
    paddingVertical: 12,
  },
});
