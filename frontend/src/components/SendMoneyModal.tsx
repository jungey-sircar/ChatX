import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import api from '../services/api';

interface Props {
  visible: boolean;
  onClose: () => void;
  receiverId: string;
  receiverName: string;
  onSent?: (txId: string) => void;
}

const QUICK_AMOUNTS = [10, 50, 100, 500, 1000];

export const SendMoneyModal: React.FC<Props> = ({
  visible,
  onClose,
  receiverId,
  receiverName,
  onSent,
}) => {
  const theme = useTheme();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  React.useEffect(() => {
    if (visible) {
      setAmount('');
      setNote('');
      api.get('/wallet').then(r => setBalance(r.data?.balance ?? 0)).catch(() => {});
    }
  }, [visible]);

  const handleSend = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter an amount greater than 0.');
      return;
    }
    if (balance !== null && amt > balance) {
      Alert.alert('Insufficient Balance', `Your balance is $${balance.toFixed(2)}.`);
      return;
    }

    setSending(true);
    try {
      const res = await api.post('/messages/send-money', {
        receiver_id: receiverId,
        amount: amt,
        note: note.trim(),
      });
      setSending(false);
      onSent?.(res.data?.transaction?.id);
      onClose();
    } catch (error: any) {
      setSending(false);
      Alert.alert('Failed', error.response?.data?.detail || 'Could not send money');
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
              <Ionicons name="close" size={26} color={theme.text} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Send Money</Text>
            <View style={styles.headerBtn} />
          </View>

          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {/* Receiver */}
            <View style={styles.recipientRow}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>To</Text>
              <Text style={[styles.recipientName, { color: theme.text }]}>{receiverName}</Text>
            </View>

            {/* Balance */}
            <View style={[styles.balanceCard, { backgroundColor: theme.surface }]}>
              <Text style={[styles.balanceLabel, { color: theme.textSecondary }]}>
                Available Balance
              </Text>
              <Text style={[styles.balanceAmount, { color: theme.primary }]}>
                {balance === null ? '—' : `$${balance.toFixed(2)}`}
              </Text>
            </View>

            {/* Amount input */}
            <Text style={[styles.label, { color: theme.textSecondary, marginTop: 24 }]}>
              Amount
            </Text>
            <View style={[styles.amountWrap, { backgroundColor: theme.surface }]}>
              <Text style={[styles.currency, { color: theme.text }]}>$</Text>
              <TextInput
                style={[styles.amountInput, { color: theme.text }]}
                placeholder="0.00"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                value={amount}
                onChangeText={setAmount}
                autoFocus
              />
            </View>

            {/* Quick amounts */}
            <View style={styles.quickRow}>
              {QUICK_AMOUNTS.map(a => (
                <TouchableOpacity
                  key={a}
                  style={[styles.quickChip, { backgroundColor: theme.surface }]}
                  onPress={() => setAmount(String(a))}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.quickChipText, { color: theme.text }]}>${a}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Note */}
            <Text style={[styles.label, { color: theme.textSecondary, marginTop: 24 }]}>
              Note (optional)
            </Text>
            <View style={[styles.noteWrap, { backgroundColor: theme.surface }]}>
              <TextInput
                style={[styles.noteInput, { color: theme.text }]}
                placeholder="What's it for?"
                placeholderTextColor={theme.textSecondary}
                value={note}
                onChangeText={setNote}
                maxLength={120}
                multiline
              />
            </View>
          </ScrollView>

          {/* Send button */}
          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <TouchableOpacity
              style={[
                styles.sendBtn,
                { backgroundColor: theme.primary },
                (!amount || sending) && { opacity: 0.6 },
              ]}
              onPress={handleSend}
              disabled={!amount || sending}
              activeOpacity={0.85}
            >
              {sending ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="paper-plane" size={18} color="#FFF" />
                  <Text style={styles.sendBtnText}>
                    Send {amount ? `$${parseFloat(amount).toFixed(2)}` : ''}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  headerBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  scroll: { padding: 20 },
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  label: { fontSize: 13, fontWeight: '500' },
  recipientName: { fontSize: 16, fontWeight: '700' },
  balanceCard: {
    padding: 16,
    borderRadius: 14,
    marginTop: 8,
    alignItems: 'center',
  },
  balanceLabel: { fontSize: 12, marginBottom: 4 },
  balanceAmount: { fontSize: 24, fontWeight: '800' },
  amountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
  },
  currency: { fontSize: 28, fontWeight: '700', marginRight: 6 },
  amountInput: {
    flex: 1,
    fontSize: 28,
    fontWeight: '700',
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  quickChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
  },
  quickChipText: { fontSize: 14, fontWeight: '600' },
  noteWrap: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    minHeight: 60,
  },
  noteInput: { fontSize: 15, minHeight: 40 },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 0.5,
  },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  sendBtnText: { color: '#FFF', fontWeight: '700', fontSize: 16 },
});
