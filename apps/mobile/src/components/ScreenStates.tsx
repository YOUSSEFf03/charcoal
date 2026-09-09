import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#1D4ED8" />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.icon}>📦</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function ErrorState({ label, detail }: { label: string; detail?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.errorText}>{label}</Text>
      {detail ? <Text style={styles.muted}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  icon: {
    fontSize: 32,
    marginBottom: 4,
  },
  muted: {
    color: '#64748B',
    fontSize: 13.5,
    textAlign: 'center',
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});
