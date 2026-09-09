import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import type { MobileContainer } from '../api/types';
import { STATUS_LABEL } from '../utils/status';
import { estimateLaneProgress, etaCountdownColor, formatEtaCountdown } from '../utils/format';
import { useContainerNickname } from '../hooks/useContainerNickname';
import { colors, monoFont } from '../theme';

const ETA_COLOR = {
  overdue: colors.danger,
  soon: colors.amber,
  normal: colors.ink,
  unknown: colors.inkSoft,
} as const;

export function ContainerListItem({ container }: { container: MobileContainer }) {
  const { tracking } = container;
  const { nickname, setNickname } = useContainerNickname(container.id);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [pressed, setPressed] = useState(false);

  function openRename() {
    setDraft(nickname ?? '');
    setRenaming(true);
  }

  async function saveRename() {
    await setNickname(draft);
    setRenaming(false);
  }

  const progress = tracking ? estimateLaneProgress(tracking.eta) : 0;
  const carrierLine = [container.sealineName, tracking?.status].filter(Boolean).join(' · ');

  return (
    <>
      {/*
        Link's `asChild` merges props onto this Pressable via Radix's Slot,
        which merges `style` with an object spread — a *function*-valued
        style (Pressable's pressed-state form) spreads to `{}`, silently
        wiping out every card style. So this Pressable stays unstyled, and
        the pressed effect + all real styling live on the inner View instead.
      */}
      <Link href={{ pathname: '/container/[id]', params: { id: container.id } }} asChild>
        <Pressable onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}>
          <View style={[styles.card, pressed && styles.pressed]}>
            <View style={styles.cardTop}>
              <View style={styles.idBlock}>
                <View style={styles.cidRow}>
                  <Text style={styles.cid} numberOfLines={1}>
                    {container.containerNumber}
                  </Text>
                  <Pressable hitSlop={8} onPress={openRename} style={styles.renameButton}>
                    <Text style={styles.renameButtonText}>✎</Text>
                  </Pressable>
                </View>
                {nickname ? (
                  <Text style={styles.alias} numberOfLines={1}>
                    {nickname}
                  </Text>
                ) : null}
              </View>
              <View style={styles.statusPill}>
                <Text style={styles.statusPillText}>{STATUS_LABEL[container.status]}</Text>
              </View>
            </View>

            {container.notes ? (
              <View style={styles.cargo}>
                <Text style={styles.cargoLabel}>CARGO</Text>
                <Text style={styles.cargoText} numberOfLines={2}>
                  {container.notes}
                </Text>
              </View>
            ) : null}

            {tracking ? (
              <>
                <View style={styles.lane}>
                  <View style={styles.ports}>
                    <Text style={styles.portsText}>ORIGIN</Text>
                    <Text style={styles.portsText}>DESTINATION</Text>
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
                    <View style={[styles.shipMarker, { left: `${progress * 100}%` }]} />
                  </View>
                </View>

                <View style={styles.laneFooter}>
                  <View style={styles.carrier}>
                    <View style={[styles.dot, tracking.isDelayed && styles.dotDelayed]} />
                    <Text style={styles.carrierText} numberOfLines={1}>
                      {carrierLine || 'Carrier unknown'}
                    </Text>
                  </View>
                  <View style={styles.etaChip}>
                    <Text style={[styles.etaChipText, { color: ETA_COLOR[etaCountdownColor(tracking.eta)] }]}>
                      {formatEtaCountdown(tracking.eta)}
                    </Text>
                  </View>
                </View>
              </>
            ) : (
              <Text style={styles.notTracked}>Not tracked yet</Text>
            )}
          </View>
        </Pressable>
      </Link>

      <Modal visible={renaming} transparent animationType="fade" onRequestClose={() => setRenaming(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Name this container</Text>
            <Text style={styles.modalSubtitle}>Only visible on this device — not saved to the server.</Text>
            <TextInput
              style={styles.modalInput}
              value={draft}
              onChangeText={setDraft}
              placeholder={container.containerNumber}
              placeholderTextColor="#94A3B8"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveRename}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalButton} onPress={() => setRenaming(false)}>
                <Text style={styles.modalButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalButton, styles.modalButtonPrimary]} onPress={saveRename}>
                <Text style={[styles.modalButtonText, styles.modalButtonTextPrimary]}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    marginHorizontal: 14,
    marginVertical: 6,
    padding: 18,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.8,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  idBlock: {
    flex: 1,
  },
  cidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cid: {
    fontFamily: monoFont,
    fontSize: 17,
    fontWeight: '600',
    color: colors.ink,
    flexShrink: 1,
  },
  renameButton: {
    paddingHorizontal: 2,
  },
  renameButtonText: {
    fontSize: 13,
    color: colors.inkSoft,
  },
  alias: {
    fontSize: 13.5,
    color: colors.inkSoft,
    marginTop: 3,
  },
  statusPill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.amberBg,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.amber,
  },
  cargo: {
    marginTop: 14,
  },
  cargoLabel: {
    fontFamily: monoFont,
    fontSize: 10.5,
    color: colors.inkSoft,
    marginBottom: 4,
  },
  cargoText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
  },
  lane: {
    marginTop: 20,
  },
  ports: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  portsText: {
    fontFamily: monoFont,
    fontSize: 11,
    color: colors.inkSoft,
  },
  track: {
    height: 4,
    borderRadius: 4,
    backgroundColor: colors.line,
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: '100%',
    backgroundColor: colors.teal,
    borderRadius: 4,
  },
  shipMarker: {
    position: 'absolute',
    top: '50%',
    width: 14,
    height: 14,
    marginLeft: -7,
    marginTop: -7,
    borderRadius: 7,
    backgroundColor: colors.teal,
    borderWidth: 2,
    borderColor: colors.card,
  },
  laneFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  carrier: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginRight: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.teal,
  },
  dotDelayed: {
    backgroundColor: colors.danger,
  },
  carrierText: {
    fontSize: 13,
    color: colors.inkSoft,
    flexShrink: 1,
  },
  etaChip: {
    backgroundColor: colors.bg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  etaChipText: {
    fontFamily: monoFont,
    fontSize: 13,
    fontWeight: '600',
  },
  notTracked: {
    marginTop: 14,
    fontSize: 12.5,
    color: '#94A3B8',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    gap: 10,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
  },
  modalSubtitle: {
    fontSize: 12,
    color: colors.inkSoft,
    marginTop: -4,
  },
  modalInput: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.ink,
    marginTop: 4,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  modalButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  modalButtonPrimary: {
    backgroundColor: colors.tealDeep,
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.inkSoft,
  },
  modalButtonTextPrimary: {
    color: '#FFFFFF',
  },
});
