import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { WebView } from 'react-native-webview';

const splashAsset = require('../../assets/Tably_splash_screen.html');

export function SplashScreen({ onReady }: { onReady?: () => void }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadSplash() {
      const asset = Asset.fromModule(splashAsset);
      await asset.downloadAsync();
      if (!asset.localUri) throw new Error('The bundled splash screen could not be located.');
      const content = await FileSystem.readAsStringAsync(asset.localUri);
      if (active) setHtml(content);
    }
    void loadSplash().catch(error => {
      console.error('Unable to load the Tably splash screen:', error);
      if (active) onReady?.();
    });
    return () => { active = false; };
  }, [onReady]);

  return (
    <View style={styles.root} accessibilityLabel="Tably loading">
      {html && <WebView
            source={{ html }}
            onLoadEnd={onReady}
            onError={onReady}
            style={styles.webView}
            containerStyle={styles.webView}
            originWhitelist={['*']}
            javaScriptEnabled
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            setSupportMultipleWindows={false}
          />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: '#FAF9F5' },
  webView: { flex: 1, backgroundColor: '#FAF9F5' },
});
