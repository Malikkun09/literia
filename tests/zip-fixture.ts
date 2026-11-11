import { crc32, deflateRawSync } from "zlib";

type ZipFile = { name: string; data: Buffer; method?: 0 | 8 };

export function buildZip(files: ZipFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name);
    const method = file.method ?? 0;
    const stored = method === 8 ? deflateRawSync(file.data) : file.data;
    const checksum = crc32(file.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(Buffer.concat([local, name, stored]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += 30 + name.length + stored.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

export function officePackage(
  kind: "docx" | "pptx" | "xlsx",
  extra: ZipFile[] = [],
  method: 0 | 8 = 0,
): Buffer {
  const main =
    kind === "docx"
      ? {
          part: "word/document.xml",
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
          xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Halo LITERIA</w:t></w:r></w:p></w:body></w:document>`,
        }
      : kind === "pptx"
        ? {
            part: "ppt/presentation.xml",
            type: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
            xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
          }
        : {
            part: "xl/workbook.xml",
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
            xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>`,
          };

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/${main.part}" ContentType="${main.type}"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main.part}"/>
</Relationships>`;

  return buildZip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes), method },
    { name: "_rels/.rels", data: Buffer.from(rels), method },
    { name: main.part, data: Buffer.from(main.xml), method },
    ...extra.map((entry) => ({ ...entry, method: entry.method ?? method })),
  ]);
}
