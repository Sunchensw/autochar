export interface BatchResult {
  row: number;
  status: 'success' | 'failed' | 'dry-run';
  message: string;
  currentUrl: string;
  screenshot: string;
  time: string;
  durationMs: number;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function writeCsvResults(results: BatchResult[], outputPath: string): Promise<void> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const headers: (keyof BatchResult)[] = ['row', 'status', 'message', 'currentUrl', 'screenshot', 'time', 'durationMs'];
  const lines = [
    headers.join(','),
    ...results.map((result) => headers.map((header) => csvCell(result[header])).join(','))
  ];
  await fs.writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
}
