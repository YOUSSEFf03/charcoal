import { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useContainers } from '../src/hooks/useContainers';
import { ContainerListItem } from '../src/components/ContainerListItem';
import { EmptyState, ErrorState, LoadingState } from '../src/components/ScreenStates';
import { daysUntil } from '../src/utils/format';
import { colors, monoFont } from '../src/theme';
import type { ContainerStatus, MobileContainer } from '../src/api/types';
import type { ApiErrorShape } from '../src/api/types';

const PAGE_SIZE = 20;

const STATUS: ContainerStatus = 'transit';

export default function ContainerListScreen() {
  const status = STATUS;
  const insets = useSafeAreaInsets();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<MobileContainer[]>([]);

  // Debounce the search box so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Any filter change starts a fresh accumulated list from page 1.
  useEffect(() => {
    setPage(1);
    setItems([]);
  }, [status, search]);

  const query = useContainers({ page, limit: PAGE_SIZE, status, search: search || undefined });

  useEffect(() => {
    if (!query.data) return;
    setItems((prev) => {
      if (query.data.page === 1) return query.data.data;
      const seen = new Set(prev.map((c) => c.id));
      return [...prev, ...query.data.data.filter((c) => !seen.has(c.id))];
    });
  }, [query.data]);

  const canLoadMore = query.data ? items.length < query.data.total : false;

  function handleEndReached() {
    if (canLoadMore && !query.isFetching) setPage((p) => p + 1);
  }

  function handleRefresh() {
    // Keep existing items visible while refetching — the merge effect above
    // replaces them wholesale once page-1 data comes back, so clearing here
    // would just flash the list to empty for no reason.
    setPage(1);
    query.refetch();
  }

  const activeCount = query.data?.total ?? items.length;

  const nextArrivalLabel = useMemo(() => {
    const days = items.map((c) => daysUntil(c.tracking?.eta)).filter((d): d is number => d !== null);
    if (days.length === 0) return '—';
    const min = Math.min(...days);
    return min <= 0 ? 'Today' : `${min}d`;
  }, [items]);

  const carrierLabel = useMemo(() => {
    const names = new Set(items.map((c) => c.sealineName).filter((n): n is string => !!n));
    if (names.size === 0) return '—';
    if (names.size === 1) return [...names][0];
    return 'Mixed';
  }, [items]);

  const error = query.error as ApiErrorShape | null;

  const body = useMemo(() => {
    if (query.isLoading && items.length === 0) return <LoadingState label="Loading containers…" />;
    if (error && items.length === 0) {
      return (
        <ErrorState
          label="Couldn't load containers"
          detail={error.code === 'NETWORK_ERROR' ? 'Check your connection and pull down to retry.' : error.error}
        />
      );
    }
    if (items.length === 0) {
      return <EmptyState label={search ? 'No containers match this search.' : 'No containers in transit.'} />;
    }
    return (
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ContainerListItem container={item} />}
        contentContainerStyle={styles.listContent}
        onEndReachedThreshold={0.4}
        onEndReached={handleEndReached}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching && page === 1}
            onRefresh={handleRefresh}
            tintColor={colors.teal}
            colors={[colors.teal]}
          />
        }
        ListFooterComponent={canLoadMore && query.isFetching ? <LoadingState label="Loading more…" /> : null}
      />
    );
  }, [items, query.isLoading, query.isFetching, error, canLoadMore, page, search, status]);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.eyebrow}>FREIGHT / OCEAN</Text>
        <Text style={styles.title}>Container Tracking</Text>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search container number…"
            placeholderTextColor="#9FB3BC"
            value={searchInput}
            onChangeText={setSearchInput}
            autoCorrect={false}
            autoCapitalize="characters"
            returnKeyType="search"
          />
        </View>
      </View>

      <View style={styles.fleetSummary}>
        <View style={styles.stat}>
          <Text style={styles.statNum}>{activeCount}</Text>
          <Text style={styles.statLabel}>Active shipment{activeCount === 1 ? '' : 's'}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statNum}>{nextArrivalLabel}</Text>
          <Text style={styles.statLabel}>Next arrival</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statNum} numberOfLines={1}>
            {carrierLabel}
          </Text>
          <Text style={styles.statLabel}>Carrier</Text>
        </View>
      </View>

      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    backgroundColor: colors.ink,
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  eyebrow: {
    fontFamily: monoFont,
    fontSize: 11,
    letterSpacing: 1,
    color: '#8FB6BC',
    marginBottom: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  searchBar: {
    marginTop: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchIcon: {
    fontSize: 15,
    color: '#9FB3BC',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#FFFFFF',
    padding: 0,
  },
  fleetSummary: {
    flexDirection: 'row',
    gap: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  stat: {
    flexShrink: 1,
  },
  statNum: {
    fontFamily: monoFont,
    fontSize: 19,
    fontWeight: '600',
    color: colors.ink,
  },
  statLabel: {
    fontSize: 11.5,
    color: colors.inkSoft,
    marginTop: 2,
  },
  listContent: {
    paddingVertical: 8,
  },
});
