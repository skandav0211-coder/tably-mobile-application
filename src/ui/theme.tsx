import React, { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_STORAGE_KEY = 'appTheme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [savedMode, setSavedMode] = useState<ThemeMode | null>(null);
  const userChanged = useRef(false);
  const mode = savedMode || (systemScheme === 'dark' ? 'dark' : 'light');

  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(THEME_STORAGE_KEY).then(value => {
      if (active && !userChanged.current && (value === 'light' || value === 'dark')) setSavedMode(value);
    }).catch(error => {
      console.error('Unable to load saved appearance preference:', error);
    });
    return () => { active = false; };
  }, []);

  const setMode = useCallback(async (nextMode: ThemeMode) => {
    userChanged.current = true;
    setSavedMode(nextMode);
    try {
      await SecureStore.setItemAsync(THEME_STORAGE_KEY, nextMode);
    } catch (error) {
      Alert.alert('Appearance not saved', 'Your theme changed for this session, but could not be saved on this device.');
      throw error;
    }
  }, []);

  return <ThemeContext.Provider value={{ mode, setMode }}>{children}</ThemeContext.Provider>;
}

export function useThemeMode(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useThemeMode must be used inside ThemeProvider.');
  return value;
}
