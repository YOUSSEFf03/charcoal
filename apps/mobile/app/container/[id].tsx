import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useContainerDetail, useTrackingEvents } from '../../src/hooks/useContainerDetail';
import { StatusBadge, DelayBadge, TrackingStatusBadge } from '../../src/components/StatusBadge';
import { TrackingTimeline } from '../../src/components/TrackingTimeline';
import { ErrorState, LoadingState } from '../../src/components/ScreenStates';
import { routeLine } from '../../src/utils/status';
import { formatDate, formatDateTime, formatEtaCountdown } from '../../src/utils/format';
import type { ApiErrorShape } from '../../src/api/types';

export default function ContainerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useContainerDetail(id);
  const events = useTrackingEvents(id);

  const error = detail.error as ApiErrorShape | null;

  if (detail.isLoading) {
    return <LoadingState label="Loading container…" />;
  }

  if (error || !detail.data) {
    return (
      <ErrorState
        label={error?.status === 404 ? 'Container not found' : "Couldn't load this container"}
        detail={error?.status === 404 ? 'It may have been removed.' : error?.error}
      />
    );
  }

  const container = detail.data;
  const { tracking } = container;
  const route = routeLine(tracking);

  return (
    <>
      <Stack.Screen options={{ title: container.containerNumber }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={detail.isFetching} onRefresh={() => { detail.refetch(); events.refetch(); }} />
        }
      >
        {/* Primary identity block */}
        <View style={styles.headerCard}>
          <View style={styles.headerTop}>
            <Text style={styles.number}>{container.containerNumber}</Text>
            <StatusBadge status={container.status} />
          </View>
          <Text style={styles.supplier}>
            {container.supplier.name} · {container.supplier.country}
          </Text>
          {container.sealineName ? <Text style={styles.sealine}>{container.sealineName}</Text> : null}
          {container.notes ? <Text style={styles.notes}>{container.notes}</Text> : null}
        </View>

        {/* Arrival / ETA */}
        {container.status === 'arrived' ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Arrival date</Text>
            <Text style={styles.sectionValue}>{formatDate(container.arrivalDate)}</Text>
          </View>
        ) : tracking?.eta ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>ETA</Text>
            <Text style={styles.sectionValue}>
              {formatDate(tracking.eta)} · {formatEtaCountdown(tracking.eta)}
            </Text>
          </View>
        ) : null}

        {/* Tracking summary */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tracking</Text>
          {!tracking ? (
            <Text style={styles.muted}>Not tracked yet. The next automatic refresh will populate this.</Text>
          ) : (
            <>
              <View style={styles.badgeRow}>
                {tracking.status ? <TrackingStatusBadge status={tracking.status} /> : null}
                {tracking.isDelayed ? <DelayBadge /> : null}
              </View>
              <View style={styles.grid}>
                <Field label="Vessel" value={tracking.vessel} />
                <Field label="Voyage" value={tracking.voyage} />
                <Field label="Origin" value={tracking.origin} />
                <Field label="Destination" value={tracking.destination} />
                <Field label="Latest location" value={tracking.currentLocation} />
                <Field label="Last updated" value={formatDateTime(tracking.lastFetchedAt)} muted />
              </View>
              {route ? <Text style={styles.route}>{route}</Text> : null}
            </>
          )}
        </View>

        {/* Timeline */}
        {tracking && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Tracking timeline</Text>
            {events.isLoading ? (
              <LoadingState label="Loading timeline…" />
            ) : events.error ? (
              <Text style={styles.muted}>Timeline unavailable right now.</Text>
            ) : (
              <TrackingTimeline events={events.data ?? []} />
            )}
          </View>
        )}
      </ScrollView>
    </>
  );
}

function Field({ label, value, muted }: { label: string; value: string | null; muted?: boolean }) {
  if (!value) return null;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, muted && styles.muted]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 14,
    gap: 12,
  },
  headerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    gap: 4,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  number: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  supplier: {
    fontSize: 13.5,
    color: '#475569',
    marginTop: 4,
  },
  sealine: {
    fontSize: 12.5,
    color: '#64748B',
  },
  notes: {
    fontSize: 12.5,
    color: '#475569',
    fontStyle: 'italic',
    marginTop: 4,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
  },
  sectionLabel: {
    fontSize: 11.5,
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sectionValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
    marginTop: 2,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  field: {
    minWidth: '42%',
  },
  fieldLabel: {
    fontSize: 11,
    color: '#94A3B8',
  },
  fieldValue: {
    fontSize: 13.5,
    color: '#0F172A',
    marginTop: 1,
  },
  muted: {
    color: '#94A3B8',
  },
  route: {
    fontSize: 12.5,
    color: '#64748B',
  },
});
