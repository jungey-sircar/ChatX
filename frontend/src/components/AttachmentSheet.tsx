import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  Dimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';

const { width } = Dimensions.get('window');

export type AttachmentAction =
  | 'camera'
  | 'photo'
  | 'video'
  | 'document'
  | 'money'
  | 'gift'
  | 'location';

type ItemDef = {
  key: AttachmentAction;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
};

const ITEMS: ItemDef[] = [
  { key: 'camera',   label: 'Camera',     icon: 'camera',          color: '#FFF', bg: '#FF6B6B' },
  { key: 'photo',    label: 'Photo',      icon: 'image',           color: '#FFF', bg: '#4ECDC4' },
  { key: 'video',    label: 'Video',      icon: 'videocam',        color: '#FFF', bg: '#A78BFA' },
  { key: 'document', label: 'Document',   icon: 'document-text',   color: '#FFF', bg: '#3B82F6' },
  { key: 'money',    label: 'Send Money', icon: 'cash',            color: '#FFF', bg: '#22C55E' },
  { key: 'gift',     label: 'Gift Packet',icon: 'gift',            color: '#FFF', bg: '#EF4444' },
  { key: 'location', label: 'Location',   icon: 'location',        color: '#FFF', bg: '#F59E0B' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (action: AttachmentAction) => void;
  disabledKeys?: AttachmentAction[];
}

export const AttachmentSheet: React.FC<Props> = ({ visible, onClose, onSelect, disabledKeys = [] }) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const handlePick = (key: AttachmentAction) => {
    onClose();
    // Small delay so the close animation doesn't fight the next picker/modal opening
    setTimeout(() => onSelect(key), 180);
  };

  const visibleItems = ITEMS.filter(i => !disabledKeys.includes(i.key));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: theme.surface,
              paddingBottom: Math.max(insets.bottom + 12, 20),
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handleBar} />
          <Text style={[styles.title, { color: theme.text }]}>Share</Text>

          <View style={styles.grid}>
            {visibleItems.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={styles.gridItem}
                activeOpacity={0.7}
                onPress={() => handlePick(item.key)}
              >
                <View style={[styles.iconCircle, { backgroundColor: item.bg }]}>
                  <Ionicons name={item.icon} size={26} color={item.color} />
                </View>
                <Text style={[styles.itemLabel, { color: theme.text }]} numberOfLines={1}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.cancelBtn, { backgroundColor: theme.background }]}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={[styles.cancelText, { color: theme.text }]}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const ITEM_WIDTH = (width - 32 - 24) / 4; // 4 columns, padding 16 each side, gap 8

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  handleBar: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(127,127,127,0.4)',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    rowGap: 16,
    justifyContent: 'flex-start',
    paddingBottom: 16,
  },
  gridItem: {
    width: ITEM_WIDTH,
    alignItems: 'center',
    gap: 8,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
      },
      android: {
        elevation: 3,
      },
    }),
  },
  itemLabel: {
    fontSize: 12,
    textAlign: 'center',
  },
  cancelBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
