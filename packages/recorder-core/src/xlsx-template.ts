import type { MaterialField, MaterialOptionGroup } from './material-package';

interface WorkbookTemplateInput {
  fields: MaterialField[];
  optionGroups: MaterialOptionGroup[];
  rowCount?: number;
}

interface SheetCell {
  value?: string | number | boolean;
  formula?: string;
  style?: number;
}

interface XlsxEntry {
  name: string;
  content: string | Buffer;
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index: number): string {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function cellRef(row: number, col: number): string {
  return `${columnName(col)}${row}`;
}

function columnLockedCellRef(row: number, col: number): string {
  return `$${columnName(col)}${row}`;
}

function sheetRef(sheetName: string, startCol: number, startRow: number, endCol: number, endRow: number): string {
  return `'${sheetName.replace(/'/g, "''")}'!$${columnName(startCol)}$${startRow}:$${columnName(endCol)}$${endRow}`;
}

function safeDefinedName(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return /^[A-Za-z_]/.test(ascii) ? ascii || 'options' : `opt_${hashString(value)}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim()))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function rowXml(rowNumber: number, cells: SheetCell[]): string {
  const rendered = cells
    .map((cell, index) => {
      if (!cell || (cell.value === undefined && cell.formula === undefined)) return '';
      const ref = cellRef(rowNumber, index);
      const style = cell.style ? ` s="${cell.style}"` : '';
      if (cell.formula !== undefined) {
        return `<c r="${ref}"${style}><f>${escapeXml(cell.formula)}</f></c>`;
      }
      if (typeof cell.value === 'number') {
        return `<c r="${ref}"${style}><v>${cell.value}</v></c>`;
      }
      if (typeof cell.value === 'boolean') {
        return `<c r="${ref}" t="b"${style}><v>${cell.value ? 1 : 0}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"${style}><is><t>${escapeXml(cell.value)}</t></is></c>`;
    })
    .join('');
  return `<row r="${rowNumber}">${rendered}</row>`;
}

interface OptionWorkbookData {
  definedNames: Array<{ name: string; ref: string }>;
  listColumns: Array<{ name: string; values: string[] }>;
  optionSheetRows: SheetCell[][];
  level2LookupEndRow: number;
  level3LookupEndRow: number;
  simpleOptionNames: Map<string, string>;
}

function buildOptionWorkbookData(fields: MaterialField[], optionGroups: MaterialOptionGroup[]): OptionWorkbookData {
  const rows: SheetCell[][] = [
    [
      { value: '一级分类' },
      { value: '二级范围名' },
      { value: '' },
      { value: '一级|二级' },
      { value: '三级范围名' },
      { value: '' },
      { value: '选项列表' }
    ]
  ];
  const definedNames: Array<{ name: string; ref: string }> = [];
  const simpleOptionNames = new Map<string, string>();
  const paths = optionGroups.find((group) => group.kind === 'cascader')?.paths ?? [];

  const level1 = unique(paths.map((path) => path[0] ?? ''));
  const listColumns: Array<{ name: string; values: string[] }> = [];

  if (level1.length) {
    listColumns.push({ name: '一级分类_选项', values: level1 });
  }

  const level2LookupRows: SheetCell[][] = [];
  for (const parent of level1) {
    const values = unique(paths.filter((path) => path[0] === parent).map((path) => path[1] ?? ''));
    if (!values.length) continue;
    const rangeName = `opt_l2_${hashString(parent)}`;
    level2LookupRows.push([{ value: parent }, { value: rangeName }]);
    listColumns.push({ name: rangeName, values });
  }

  const level2Pairs = unique(paths.map((path) => `${path[0] ?? ''}|${path[1] ?? ''}`).filter((key) => !key.endsWith('|')));
  const level3LookupRows: SheetCell[][] = [];
  for (const pair of level2Pairs) {
    const [levelOne, levelTwo] = pair.split('|');
    const values = unique(paths.filter((path) => path[0] === levelOne && path[1] === levelTwo).map((path) => path[2] ?? ''));
    if (!values.length) continue;
    const rangeName = `opt_l3_${hashString(pair)}`;
    level3LookupRows.push([{ value: pair }, { value: rangeName }]);
    listColumns.push({ name: rangeName, values });
  }

  for (const field of fields) {
    if (field.controlType === 'cascaderLevel' || !field.options?.length) continue;
    const rangeName = `opt_${safeDefinedName(field.id)}`;
    simpleOptionNames.set(field.id, rangeName);
    listColumns.push({ name: rangeName, values: unique(field.options.map((option) => option.label)) });
  }

  const maxRows = Math.max(
    rows.length,
    level2LookupRows.length + 1,
    level3LookupRows.length + 1,
    ...listColumns.map((column) => column.values.length + 1)
  );
  while (rows.length < maxRows) rows.push([]);

  level2LookupRows.forEach((row, index) => {
    rows[index + 1][0] = row[0];
    rows[index + 1][1] = row[1];
  });
  level3LookupRows.forEach((row, index) => {
    rows[index + 1][3] = row[0];
    rows[index + 1][4] = row[1];
  });

  listColumns.forEach((column, index) => {
    const col = 6 + index;
    rows[0][col] = { value: column.name };
    column.values.forEach((value, rowIndex) => {
      rows[rowIndex + 1][col] = { value };
    });
  });

  const helperFields = fields.filter((field) => field.controlType === 'cascaderLevel' && field.dependsOn.length);
  const mainOptionStart = fields.length + helperFields.length;
  listColumns.forEach((column, index) => {
    if (column.values.length) {
      definedNames.push({
        name: column.name,
        ref: sheetRef('字段模板', mainOptionStart + index, 2, mainOptionStart + index, column.values.length + 1)
      });
    }
  });

  return {
    definedNames,
    listColumns,
    optionSheetRows: rows,
    level2LookupEndRow: Math.max(2, level2LookupRows.length + 1),
    level3LookupEndRow: Math.max(2, level3LookupRows.length + 1),
    simpleOptionNames
  };
}

function buildTemplateSheet(input: WorkbookTemplateInput, optionData: OptionWorkbookData): string {
  const rowCount = input.rowCount ?? 100;
  const headers = input.fields.map((field) => ({ value: field.column, style: 1 }));
  const helperFields = input.fields.filter((field) => field.controlType === 'cascaderLevel' && field.dependsOn.length);
  const helperStart = input.fields.length;
  const helperHeaders = helperFields.map((field) => ({ value: `${field.column}_选项范围`, style: 2 }));
  const optionStart = helperStart + helperFields.length;
  const optionHeaders = optionData.listColumns.map((column) => ({ value: column.name, style: 2 }));
  const sheetRowCount = Math.max(
    rowCount + 1,
    ...optionData.listColumns.map((column) => column.values.length + 1)
  );
  const rows: string[] = [rowXml(1, [...headers, ...helperHeaders, ...optionHeaders])];

  for (let row = 2; row <= sheetRowCount; row += 1) {
    const cells: SheetCell[] = input.fields.map(() => ({}));
    helperFields.forEach((field, helperIndex) => {
      const targetIndex = input.fields.indexOf(field);
      const helperCol = helperStart + helperIndex;
      const firstParent = input.fields.findIndex((candidate) => candidate.column === field.dependsOn[0]);
      const secondParent = input.fields.findIndex((candidate) => candidate.column === field.dependsOn[1]);
      if (field.dependsOn.length === 1) {
        cells[helperCol] = {
          formula: `IF(${cellRef(row, firstParent)}="","",IFERROR(VLOOKUP(${cellRef(row, firstParent)},'选项库'!$A$2:$B$${optionData.level2LookupEndRow},2,FALSE),""))`
        };
      } else {
        cells[helperCol] = {
          formula: `IF(OR(${cellRef(row, firstParent)}="",${cellRef(row, secondParent)}=""),"",IFERROR(VLOOKUP(${cellRef(row, firstParent)}&"|"&${cellRef(row, secondParent)},'选项库'!$D$2:$E$${optionData.level3LookupEndRow},2,FALSE),""))`
        };
      }
      if (!cells[targetIndex]) cells[targetIndex] = {};
    });
    optionData.listColumns.forEach((column, optionIndex) => {
      const value = column.values[row - 2];
      if (value !== undefined) {
        cells[optionStart + optionIndex] = { value };
      }
    });
    rows.push(rowXml(row, cells));
  }

  const validations = input.fields
    .map((field, index) => {
      const range = `${columnName(index)}2:${columnName(index)}${rowCount + 1}`;
      if (field.controlType === 'cascaderLevel') {
        if (!field.dependsOn.length) {
          return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${range}"><formula1>一级分类_选项</formula1></dataValidation>`;
        }
        const helperIndex = helperFields.indexOf(field);
        const helperCol = helperStart + helperIndex;
        const formula = `INDIRECT(${columnLockedCellRef(2, helperCol)})`;
        return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${range}"><formula1>${escapeXml(formula)}</formula1></dataValidation>`;
      }
      const optionName = optionData.simpleOptionNames.get(field.id);
      if (optionName) {
        return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${range}"><formula1>${escapeXml(optionName)}</formula1></dataValidation>`;
      }
      return '';
    })
    .filter(Boolean);

  const hiddenColumnCount = helperFields.length + optionData.listColumns.length;
  const hiddenCols = hiddenColumnCount
    ? `<cols><col min="${helperStart + 1}" max="${helperStart + hiddenColumnCount}" hidden="1" width="0" customWidth="1"/></cols>`
    : '';
  const dataValidations = validations.length
    ? `<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>`
    : '';
  const lastColumn = columnName(Math.max(input.fields.length + hiddenColumnCount - 1, 0));
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastColumn}${sheetRowCount}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${hiddenCols}<sheetData>${rows.join('')}</sheetData>${dataValidations}</worksheet>`;
}

function buildOptionSheet(optionRows: SheetCell[][]): string {
  const rows = optionRows.map((row, index) => rowXml(index + 1, row));
  const lastColumn = columnName(Math.max(...optionRows.map((row) => row.length), 1) - 1);
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${optionRows.length}"/><sheetData>${rows.join('')}</sheetData></worksheet>`;
}

function buildFieldSheet(fields: MaterialField[]): string {
  const rows: SheetCell[][] = [
    [
      { value: '字段' },
      { value: '控件类型' },
      { value: '是否必填' },
      { value: '依赖字段' },
      { value: '页面区域' },
      { value: 'selector' }
    ],
    ...fields.map((field) => [
      { value: field.column },
      { value: field.controlType },
      { value: field.required ? '是' : '否' },
      { value: field.dependsOn.join('、') },
      { value: field.area ?? '' },
      { value: field.selector ?? '' }
    ])
  ];
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:F${rows.length}"/><sheetData>${rows.map((row, index) => rowXml(index + 1, row)).join('')}</sheetData></worksheet>`;
}

function workbookXml(definedNames: Array<{ name: string; ref: string }>): string {
  const names = definedNames.length
    ? `<definedNames>${definedNames.map((item) => `<definedName name="${escapeXml(item.name)}">${escapeXml(item.ref)}</definedName>`).join('')}</definedNames>`
    : '';
  return `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="字段模板" sheetId="1" r:id="rId1"/><sheet name="选项库" sheetId="2" state="hidden" r:id="rId2"/><sheet name="字段说明" sheetId="3" r:id="rId3"/></sheets>${names}<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;
}

function workbookRelsXml(): string {
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function rootRelsXml(): string {
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function contentTypesXml(): string {
  return `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
}

function stylesXml(): string {
  return `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei UI"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei UI"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="1" borderId="0" xfId="0" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

export function buildTemplateWorkbook(input: WorkbookTemplateInput): Buffer {
  const optionData = buildOptionWorkbookData(input.fields, input.optionGroups);
  const entries: XlsxEntry[] = [
    { name: '[Content_Types].xml', content: contentTypesXml() },
    { name: '_rels/.rels', content: rootRelsXml() },
    { name: 'xl/workbook.xml', content: workbookXml(optionData.definedNames) },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml() },
    { name: 'xl/styles.xml', content: stylesXml() },
    { name: 'xl/worksheets/sheet1.xml', content: buildTemplateSheet(input, optionData) },
    { name: 'xl/worksheets/sheet2.xml', content: buildOptionSheet(optionData.optionSheetRows) },
    { name: 'xl/worksheets/sheet3.xml', content: buildFieldSheet(input.fields) }
  ];
  return zip(entries);
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: XlsxEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const flags = 0x0800;
  const method = 0;
  const time = 0;
  const date = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8');
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + content.length;
  }

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}
