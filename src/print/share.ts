import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

export async function sharePdf(html: string, name: string) {
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: name, UTI: 'com.adobe.pdf' });
}
export async function shareCsv(csv: string, name: string) {
  const uri = (FileSystem.cacheDirectory || '') + name;
  await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: name });
}
