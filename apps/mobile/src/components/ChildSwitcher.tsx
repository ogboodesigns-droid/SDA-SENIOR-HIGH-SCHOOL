import { Pressable, ScrollView, Text } from 'react-native';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

/** Lets a parent with more than one child at the school choose whose records to view. */
export function ChildSwitcher() {
  const { me, child, selectChild } = useAuth();
  if (me?.role !== 'parent' || me.children.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {me.children.map((c) => {
        const active = c.id === child?.id;
        return (
          <Pressable
            key={c.id}
            onPress={() => selectChild(c.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: active ? colors.brand : '#fff',
              borderWidth: 1,
              borderColor: colors.brand,
            }}
          >
            <Text style={{ color: active ? '#fff' : colors.brand, fontWeight: '600' }}>{c.fullName.split(' ')[0]}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
