/**
 * Reads a CSV file as text. Excel pt-BR's default "CSV (separado por vírgulas)" is saved in
 * Windows-1252, not UTF-8; decoding it as UTF-8 would garble every accent. Strict UTF-8 first,
 * then Windows-1252.
 */
export function decodeCsvBytes(bytes: Uint8Array): {
  text: string;
  encoding: 'utf-8' | 'windows-1252';
} {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

export async function readCsvFile(
  file: Blob,
): Promise<{ text: string; encoding: 'utf-8' | 'windows-1252' }> {
  return decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
}

export const CSV_TEMPLATE =
  'nome;mac;ip;hostname;sala;tags;observacoes;ativo\r\n' +
  'LAB3-PC01;AA:BB:CC:DD:EE:01;10.0.3.21;LAB3-PC01;Lab 3;professor|Win11;Mesa do professor;sim\r\n';
