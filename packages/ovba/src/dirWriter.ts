/**
 * Write a decompressed dir stream in the record order of MS-OVBA 2.3.4.2, the way Excel does.
 * Used to build test fixtures; validated against an independent reader (olevba/oletools).
 */
export interface DirWriterModule {
  name: string;
  /** Module name encoded in the project code page. */
  nameMbcs: Uint8Array;
}

/** A REFERENCENAME + REFERENCEREGISTERED pair. Strings are encoded in the project code page. */
export interface DirWriterReference {
  name: string;
  nameMbcs: Uint8Array;
  libidMbcs: Uint8Array;
}

export interface DirWriterOptions {
  codePage: number;
  projectName: string;
  modules: DirWriterModule[];
  /** PROJECTREFERENCES, in this order. Nothing is written when absent or empty. */
  references?: DirWriterReference[];
}

class Out {
  bytes: number[] = [];
  u16(v: number) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff);
  }
  u32(v: number) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  }
  raw(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.bytes.push(b[i]!);
  }
  record(id: number, data: ArrayLike<number>) {
    this.u16(id);
    this.u32(data.length);
    this.raw(data);
  }
}

function utf16le(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out.push(c & 0xff, c >> 8);
  }
  return out;
}

function u32le(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
}

export function writeDirStream(opts: DirWriterOptions): Uint8Array {
  const o = new Out();
  const ascii = (s: string) => Array.from(s, (ch) => ch.charCodeAt(0));

  // PROJECTINFORMATION
  o.record(0x0001, u32le(1)); // SysKind: 32-bit Windows
  o.record(0x0002, u32le(0x0409)); // Lcid
  o.record(0x0014, u32le(0x0409)); // LcidInvoke
  o.record(0x0003, [opts.codePage & 0xff, (opts.codePage >> 8) & 0xff]); // CodePage
  o.record(0x0004, ascii(opts.projectName)); // Name
  o.record(0x0005, []); // DocString
  o.record(0x0040, []); //   DocStringUnicode
  o.record(0x0006, []); // HelpFilePath1
  o.record(0x003d, []); //   HelpFilePath2
  o.record(0x0007, u32le(0)); // HelpContext
  o.record(0x0008, u32le(0)); // LibFlags
  o.u16(0x0009); // Version: Id | Reserved=4 | Major(4) | Minor(2)
  o.u32(4);
  o.u32(1);
  o.u16(0);
  o.record(0x000c, []); // Constants
  o.record(0x003c, []); //   ConstantsUnicode

  // PROJECTREFERENCES (2.3.4.2.2): only the ones the fixture asks for. A real Excel project also
  // references stdole and Office; not needed here.
  for (const r of opts.references ?? []) {
    o.record(0x0016, r.nameMbcs); // REFERENCENAME.Name
    o.record(0x003e, utf16le(r.name)); //   Reserved 0x003E + NameUnicode
    // REFERENCEREGISTERED: Size covers SizeOfLibid, Libid, Reserved1 (4), Reserved2 (2)
    o.record(0x000d, [...u32le(r.libidMbcs.length), ...Array.from(r.libidMbcs), ...u32le(0), 0, 0]);
  }

  // PROJECTMODULES
  o.record(0x000f, [opts.modules.length & 0xff, (opts.modules.length >> 8) & 0xff]);
  o.record(0x0013, [0xff, 0xff]); // ProjectCookie
  for (const m of opts.modules) {
    o.record(0x0019, m.nameMbcs); // ModuleName
    o.record(0x0047, utf16le(m.name)); // ModuleNameUnicode
    o.record(0x001a, m.nameMbcs); // ModuleStreamName
    o.record(0x0032, utf16le(m.name)); //   StreamNameUnicode
    o.record(0x001c, []); // ModuleDocString
    o.record(0x0048, []); //   DocStringUnicode
    o.record(0x0031, u32le(0)); // ModuleOffset: source starts at byte 0 (no p-code cache)
    o.record(0x001e, u32le(0)); // ModuleHelpContext
    o.record(0x002c, [0xff, 0xff]); // ModuleCookie
    o.record(0x0021, []); // ModuleTypeProcedural
    o.record(0x002b, []); // Module Terminator
  }
  o.record(0x0010, []); // PROJECTMODULES Terminator
  return Uint8Array.from(o.bytes);
}
