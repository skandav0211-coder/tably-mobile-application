import { PermissionsAndroid, Platform } from 'react-native';
import { Buffer } from 'buffer';
import type { PrinterConfig } from '../core/types';

export class PrintError extends Error {}
const NATIVE_HINT = 'Direct printing needs the installed app build (not Expo Go). Use "Share PDF" meanwhile.';

// Static requires (Metro cannot bundle dynamic ones). Wrapped so Expo Go, which lacks these native modules, falls back to the PDF hint.
const NATIVE: Record<string, () => any> = {
  'react-native-bluetooth-classic': () => require('react-native-bluetooth-classic'),
  'react-native-tcp-socket': () => require('react-native-tcp-socket'),
};
function load(name: string): any { try { const m = NATIVE[name](); if (!m?.default) throw new Error('missing'); return m; } catch { throw new PrintError(NATIVE_HINT); } }

async function askBluetoothPermission() {
  if (Platform.OS !== 'android' || (Platform.Version as number) < 31) return;
  const r = await PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN]);
  if (Object.values(r).some(v => v !== PermissionsAndroid.RESULTS.GRANTED)) throw new PrintError('Bluetooth permission was denied. Allow "Nearby devices" in Android settings.');
}

/** Printers must be paired in Android Bluetooth settings first. */
export async function pairedBluetoothPrinters(): Promise<{ name: string; address: string }[]> {
  const BT = load('react-native-bluetooth-classic').default;
  await askBluetoothPermission();
  if (!(await BT.isBluetoothEnabled())) throw new PrintError('Bluetooth is turned off.');
  return (await BT.getBondedDevices()).map((d: any) => ({ name: d.name || d.address, address: d.address }));
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function sendBluetooth(address: string, bytes: Uint8Array) {
  const BT = load('react-native-bluetooth-classic').default; await askBluetoothPermission();
  let dev: any;
  try {
    dev = (await BT.isDeviceConnected?.(address)) ? await BT.getConnectedDevice(address) : await BT.connectToDevice(address);
    for (let i = 0; i < bytes.length; i += 256) { await dev.write(Buffer.from(bytes.slice(i, i + 256))); await sleep(25); }
    await sleep(300);
  } catch (e: any) { throw new PrintError('Printer connection failed: ' + (e?.message || 'unknown error')); }
  finally { try { await dev?.disconnect(); } catch { /* ignore */ } }
}

/** Wi-Fi / LAN printers: raw ESC/POS over TCP port 9100 (address "host" or "host:port"). */
async function sendNetwork(address: string, bytes: Uint8Array) {
  const TcpSocket = load('react-native-tcp-socket').default; const [host, port] = address.split(':');
  await new Promise<void>((resolve, reject) => {
    const sock = TcpSocket.createConnection({ host, port: Number(port) || 9100, timeout: 8000 } as any, () => { sock.write(Buffer.from(bytes), undefined, (err?: Error) => { if (err) reject(new PrintError('Printer write failed: ' + err.message)); else { setTimeout(() => { sock.destroy(); resolve(); }, 400); } }); });
    sock.on('error', (e: Error) => reject(new PrintError('Cannot reach printer at ' + address + ': ' + e.message)));
    sock.on('timeout', () => { sock.destroy(); reject(new PrintError('Printer did not respond (timeout).')); });
  });
}

/** Throws PrintError on any failure. Callers keep the bill, never mark it printed on error, and offer retry / PDF. */
export async function printBytes(cfg: PrinterConfig | null, bytes: Uint8Array): Promise<void> {
  if (!cfg) throw new PrintError('No printer selected. Set one up in More → Printer.');
  if (cfg.kind === 'bluetooth') return sendBluetooth(cfg.address, bytes);
  return sendNetwork(cfg.address, bytes);
}
