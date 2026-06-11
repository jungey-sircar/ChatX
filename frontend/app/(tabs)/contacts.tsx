import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Alert,
  SectionList,
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import { useTheme } from '../../src/hooks/useTheme';
import { Avatar } from '../../src/components/Avatar';
import api from '../../src/services/api';
import { User } from '../../src/types';

type MatchedPhoneContact = {
  phone_number: string;
  is_registered: boolean;
  user: User | null;
  deviceName?: string;
};

export default function ContactsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const searchInputRef = useRef<TextInput>(null);
  const [appContacts, setAppContacts] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [syncingDevice, setSyncingDevice] = useState(false);
  const [deviceMatches, setDeviceMatches] = useState<MatchedPhoneContact[]>([]);
  const [hasSyncedOnce, setHasSyncedOnce] = useState(false);

  const loadAppContacts = async () => {
    try {
      const response = await api.get('/contacts');
      setAppContacts(response.data);
    } catch (error) {
      console.warn('Error loading app contacts:', error);
    }
  };

  const loadData = async () => {
    setLoading(true);
    await loadAppContacts();
    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAppContacts();
    setRefreshing(false);
  };

  // Search users on the platform
  const searchUsers = async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const response = await api.get(`/users/search?query=${encodeURIComponent(query)}`);
      const contactIds = new Set(appContacts.map(c => c.id));
      const filtered = response.data.filter((u: User) => !contactIds.has(u.id));
      setSearchResults(filtered);
    } catch (error) {
      console.warn('Error searching users:', error);
    } finally {
      setSearching(false);
    }
  };

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.length >= 2) {
        searchUsers(searchQuery);
      } else {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, appContacts]);

  const addContact = async (userId: string) => {
    try {
      await api.post('/contacts/add', { user_id: userId });
      await loadAppContacts();
      setSearchResults(prev => prev.filter(u => u.id !== userId));
      // Also update device matches
      setDeviceMatches(prev => prev.filter(m => m.user?.id !== userId));
      Alert.alert('Contact Added', 'You can now chat with this person!');
    } catch (error: any) {
      const msg = error.response?.data?.detail;
      if (msg === 'Already in contacts') {
        Alert.alert('Already Added', 'This person is already in your contacts.');
      } else {
        Alert.alert('Error', msg || 'Failed to add contact');
      }
    }
  };

  const addAndChat = async (userId: string) => {
    try {
      await api.post('/contacts/add', { user_id: userId });
      await loadAppContacts();
    } catch {
      // May already be a contact
    }
    router.push(`/chat/${userId}`);
  };

  // ============== DEVICE CONTACTS SYNC ==============
  const focusSearchBar = () => {
    searchInputRef.current?.focus();
  };

  const syncDeviceContacts = async () => {
    if (Platform.OS === 'web') {
      Alert.alert(
        'Not Available on Web',
        'Phone contact sync is only available on the mobile app. Please use the search bar above to find friends.'
      );
      return;
    }

    setSyncingDevice(true);
    try {
      // 1. Request permission
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        setSyncingDevice(false);
        Alert.alert(
          'Permission Needed',
          'ConnectX needs permission to access your phone contacts so we can find which of your friends already use ConnectX.\n\nPlease enable Contacts permission in Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }

      // 2. Read contacts with phone numbers
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });

      if (!data || data.length === 0) {
        setSyncingDevice(false);
        Alert.alert('No Contacts', 'No contacts found on your device.');
        return;
      }

      // 3. Build a list of phone numbers (deduped) and a phone->name map
      const phoneToName = new Map<string, string>();
      const phoneNumbers: string[] = [];
      for (const c of data) {
        if (!c.phoneNumbers || c.phoneNumbers.length === 0) continue;
        const name = c.name || c.firstName || 'Unknown';
        for (const p of c.phoneNumbers) {
          const num = (p.number || '').replace(/\s|-|\(|\)/g, '');
          if (num && !phoneToName.has(num)) {
            phoneToName.set(num, name);
            phoneNumbers.push(num);
          }
        }
      }

      if (phoneNumbers.length === 0) {
        setSyncingDevice(false);
        Alert.alert('No Phone Numbers', 'None of your contacts have phone numbers attached.');
        return;
      }

      // 4. Send to backend in chunks of 200
      const allMatches: MatchedPhoneContact[] = [];
      const CHUNK = 200;
      for (let i = 0; i < phoneNumbers.length; i += CHUNK) {
        const chunk = phoneNumbers.slice(i, i + CHUNK);
        try {
          const resp = await api.post('/contacts/match-phones', { phone_numbers: chunk });
          for (const m of resp.data || []) {
            allMatches.push({
              ...m,
              deviceName: phoneToName.get(m.phone_number) || phoneToName.get(m.phone_number.replace(/\D/g, '')),
            });
          }
        } catch (err) {
          console.warn('match-phones chunk failed:', err);
        }
      }

      // 5. Filter: only registered users that are NOT already in our contacts
      const myContactIds = new Set(appContacts.map(c => c.id));
      const registeredMatches = allMatches.filter(
        m => m.is_registered && m.user && !myContactIds.has(m.user.id)
      );

      setDeviceMatches(registeredMatches);
      setHasSyncedOnce(true);
      setSyncingDevice(false);

      if (registeredMatches.length === 0) {
        Alert.alert(
          'Sync Complete',
          `Checked ${phoneNumbers.length} contacts. None of your phone contacts are on ConnectX yet (or they are already in your contacts list).\n\nInvite them or search by username!`
        );
      } else {
        Alert.alert(
          'Friends Found!',
          `Found ${registeredMatches.length} friend${registeredMatches.length === 1 ? '' : 's'} from your phone contacts on ConnectX.`
        );
      }
    } catch (error: any) {
      console.warn('Sync error:', error);
      setSyncingDevice(false);
      Alert.alert('Error', 'Failed to sync contacts. Please try again.');
    }
  };

  // Filter contacts based on search
  const filteredContacts = appContacts.filter(contact => {
    if (!searchQuery) return true;
    const name = (contact.display_name || contact.username || '').toLowerCase();
    const phone = (contact.phone_number || '').toLowerCase();
    const email = (contact.email || '').toLowerCase();
    const q = searchQuery.toLowerCase();
    return name.includes(q) || phone.includes(q) || email.includes(q);
  });

  // Build sections
  const getSections = () => {
    const sections: { title: string; data: any[]; type: string }[] = [];

    // My contacts section
    if (filteredContacts.length > 0 && !isSearchFocused) {
      sections.push({
        title: `My Contacts (${filteredContacts.length})`,
        data: filteredContacts,
        type: 'contact',
      });
    } else if (filteredContacts.length > 0 && searchQuery.length >= 2) {
      const matching = filteredContacts.filter(c => {
        const q = searchQuery.toLowerCase();
        return (c.display_name || '').toLowerCase().includes(q) ||
               (c.username || '').toLowerCase().includes(q);
      });
      if (matching.length > 0) {
        sections.push({
          title: 'In Your Contacts',
          data: matching,
          type: 'contact',
        });
      }
    }

    // Friends from phone contacts (synced)
    if (deviceMatches.length > 0 && !searchQuery) {
      sections.push({
        title: `From Your Phone Contacts (${deviceMatches.length})`,
        data: deviceMatches,
        type: 'device_match',
      });
    }

    // Search results from platform
    if (searchQuery.length >= 2 && searchResults.length > 0) {
      sections.push({
        title: 'People on ConnectX',
        data: searchResults,
        type: 'search_result',
      });
    }

    return sections;
  };

  const renderContactItem = (item: User) => (
    <TouchableOpacity
      style={[styles.contactItem, { backgroundColor: theme.surface }]}
      onPress={() => router.push(`/chat/${item.id}`)}
      activeOpacity={0.7}
    >
      <Avatar
        source={item.profile_photo}
        name={item.display_name || item.username}
        size={50}
        isOnline={item.is_online}
      />
      <View style={styles.contactContent}>
        <Text style={[styles.contactName, { color: theme.text }]} numberOfLines={1}>
          {item.display_name || item.username}
        </Text>
        <Text style={[styles.contactSub, { color: theme.textSecondary }]} numberOfLines={1}>
          @{item.username}
          {item.phone_number ? ` · ${item.phone_number}` : ''}
        </Text>
      </View>
      <View style={styles.contactActions}>
        <TouchableOpacity
          style={[styles.iconBtn, { backgroundColor: theme.primary + '15' }]}
          onPress={() => router.push(`/chat/${item.id}`)}
        >
          <Ionicons name="chatbubble" size={18} color={theme.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.iconBtn, { backgroundColor: theme.primary + '15' }]}
          onPress={() => router.push(`/call/${item.id}?type=voice`)}
        >
          <Ionicons name="call" size={18} color={theme.primary} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  const renderSearchResultItem = (item: User) => (
    <TouchableOpacity
      style={[styles.contactItem, { backgroundColor: theme.surface }]}
      onPress={() => addAndChat(item.id)}
      activeOpacity={0.7}
    >
      <Avatar
        source={item.profile_photo}
        name={item.display_name || item.username}
        size={50}
      />
      <View style={styles.contactContent}>
        <Text style={[styles.contactName, { color: theme.text }]} numberOfLines={1}>
          {item.display_name || item.username}
        </Text>
        <Text style={[styles.contactSub, { color: theme.textSecondary }]} numberOfLines={1}>
          @{item.username}
          {item.phone_number ? ` · ${item.phone_number}` : ''}
        </Text>
      </View>
      <View style={styles.contactActions}>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: theme.primary }]}
          onPress={() => addContact(item.id)}
        >
          <Ionicons name="person-add" size={16} color="#FFF" />
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  const renderDeviceMatchItem = (item: MatchedPhoneContact) => {
    const u = item.user!;
    return (
      <TouchableOpacity
        style={[styles.contactItem, { backgroundColor: theme.surface }]}
        onPress={() => addAndChat(u.id)}
        activeOpacity={0.7}
      >
        <Avatar source={u.profile_photo} name={u.display_name || u.username} size={50} />
        <View style={styles.contactContent}>
          <Text style={[styles.contactName, { color: theme.text }]} numberOfLines={1}>
            {u.display_name || u.username}
          </Text>
          <Text style={[styles.contactSub, { color: theme.textSecondary }]} numberOfLines={1}>
            {item.deviceName ? `Saved as "${item.deviceName}"` : `@${u.username}`}
          </Text>
        </View>
        <View style={styles.contactActions}>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: theme.primary }]}
            onPress={() => addContact(u.id)}
          >
            <Ionicons name="person-add" size={16} color="#FFF" />
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const renderItem = ({ item, section }: { item: any; section: any }) => {
    if (section.type === 'search_result') return renderSearchResultItem(item);
    if (section.type === 'device_match') return renderDeviceMatchItem(item);
    return renderContactItem(item);
  };

  const renderSectionHeader = ({ section }: any) => (
    <View style={[styles.sectionHeader, { backgroundColor: theme.background }]}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
        {section.title}
      </Text>
    </View>
  );

  const renderEmpty = () => {
    if (searchQuery.length >= 2 && !searching && searchResults.length === 0 && filteredContacts.length === 0) {
      return (
        <View style={styles.emptySearch}>
          <Ionicons name="search" size={48} color={theme.textSecondary} />
          <Text style={[styles.emptyTitle, { color: theme.textSecondary }]}>
            No users found for &quot;{searchQuery}&quot;
          </Text>
          <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
            Try searching by username, email, or phone number
          </Text>
        </View>
      );
    }

    if (!searchQuery && appContacts.length === 0 && !loading) {
      return (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.primary + '15' }]}>
            <Ionicons name="people" size={48} color={theme.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>
            Find People to Chat With
          </Text>
          <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
            Sync your phone contacts or search for friends by username, email, or phone number.
          </Text>

          <View style={styles.tipContainer}>
            {/* Sync Phone Contacts - primary CTA */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={syncDeviceContacts}
              disabled={syncingDevice}
              style={[styles.ctaCard, { backgroundColor: theme.primary }]}
            >
              {syncingDevice ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Ionicons name="phone-portrait" size={22} color="#FFF" />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.ctaTitle}>
                  {syncingDevice ? 'Syncing…' : 'Sync Phone Contacts'}
                </Text>
                <Text style={styles.ctaSub}>
                  Find which of your contacts already use ConnectX
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#FFF" />
            </TouchableOpacity>

            {/* Search Users - clickable tip card */}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={focusSearchBar}
              style={[styles.tipCard, { backgroundColor: theme.surface }]}
            >
              <Ionicons name="search" size={20} color={theme.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.tipTitle, { color: theme.text }]}>Search Users</Text>
                <Text style={[styles.tipSub, { color: theme.textSecondary }]}>
                  Tap to type a name, email or phone number
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
            </TouchableOpacity>

            {/* Add & Chat - clickable tip card */}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={focusSearchBar}
              style={[styles.tipCard, { backgroundColor: theme.surface }]}
            >
              <Ionicons name="person-add" size={20} color={theme.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.tipTitle, { color: theme.text }]}>Add & Chat</Text>
                <Text style={[styles.tipSub, { color: theme.textSecondary }]}>
                  Tap a search result to add and chat instantly
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    return null;
  };

  const sections = getSections();

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Contacts</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Contacts</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={syncDeviceContacts}
            disabled={syncingDevice}
            style={[styles.syncBtn, { backgroundColor: theme.primary + '20' }]}
            activeOpacity={0.7}
          >
            {syncingDevice ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <Ionicons name="sync" size={18} color={theme.primary} />
            )}
            <Text style={[styles.syncBtnText, { color: theme.primary }]}>
              {hasSyncedOnce ? 'Re-sync' : 'Sync'}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.contactCount, { color: theme.textSecondary }]}>
            {appContacts.length}
          </Text>
        </View>
      </View>

      {/* Search bar */}
      <View style={[styles.searchContainer, { backgroundColor: theme.surface }]}>
        <Ionicons name="search" size={20} color={theme.textSecondary} />
        <TextInput
          ref={searchInputRef}
          style={[styles.searchInput, { color: theme.text }]}
          placeholder="Search by name, email, or phone..."
          placeholderTextColor={theme.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onFocus={() => setIsSearchFocused(true)}
          onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }}>
            <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
          </TouchableOpacity>
        )}
        {searching && <ActivityIndicator size="small" color={theme.primary} style={{ marginLeft: 8 }} />}
      </View>

      {/* Search hint */}
      {searchQuery.length > 0 && searchQuery.length < 2 && (
        <View style={styles.searchHint}>
          <Text style={[styles.searchHintText, { color: theme.textSecondary }]}>
            Type at least 2 characters to search users...
          </Text>
        </View>
      )}

      {/* Content */}
      {sections.length > 0 ? (
        <SectionList
          sections={sections}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={(item, idx) => item.id || item.phone_number || String(idx)}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={true}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
          }
        />
      ) : (
        <FlatList
          data={[]}
          renderItem={() => null}
          ListHeaderComponent={renderEmpty}
          contentContainerStyle={styles.emptyListContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
  },
  syncBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  contactCount: {
    fontSize: 13,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    marginLeft: 8,
    paddingVertical: 8,
  },
  searchHint: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  searchHintText: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  listContent: {
    paddingBottom: 100,
  },
  emptyListContent: {
    flexGrow: 1,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  contactContent: {
    flex: 1,
    marginLeft: 12,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '600',
  },
  contactSub: {
    fontSize: 13,
    marginTop: 2,
  },
  contactActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  addBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  emptySearch: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 60,
    gap: 8,
  },
  tipContainer: {
    width: '100%',
    gap: 12,
  },
  ctaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderRadius: 16,
  },
  ctaTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
  ctaSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 2,
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 14,
  },
  tipTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  tipSub: {
    fontSize: 13,
    marginTop: 2,
  },
});
