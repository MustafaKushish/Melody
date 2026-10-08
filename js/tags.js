// Lightweight ID3v2 (v2.2–v2.4) reader: title, artist, album, year, track number, cover.
// Files without ID3 fall back to "Artist - Title" parsed from the file name.

const synchsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function decode(enc, bytes) {
  let label = 'iso-8859-1';
  if (enc === 1) label = bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-16le';
  else if (enc === 2) label = 'utf-16be';
  else if (enc === 3) label = 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes).replace(/\u0000/g, ' ').replace(/^﻿/, '').trim();
  } catch {
    return '';
  }
}

// Index of the string terminator starting at `from` (1 byte for latin1/utf8, 2 aligned bytes for utf16).
function findEnd(b, from, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = from; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
  } else {
    for (let i = from; i < b.length; i++) if (b[i] === 0) return i;
  }
  return b.length;
}

function textFrame(data) {
  return data.length ? decode(data[0], data.subarray(1)) : '';
}

function pictureFrame(data, v22) {
  const enc = data[0];
  let p = 1;
  let mime;
  if (v22) {
    const fmt = String.fromCharCode(data[1], data[2], data[3]).toLowerCase();
    mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
    p = 4;
  } else {
    const end = findEnd(data, 1, 0);
    mime = decode(0, data.subarray(1, end)).toLowerCase() || 'image/jpeg';
    if (!mime.includes('/')) mime = 'image/' + (mime === 'png' ? 'png' : 'jpeg');
    p = end + 1;
  }
  const picType = data[p];
  p += 1;
  const descEnd = findEnd(data, p, enc);
  p = descEnd + (enc === 1 || enc === 2 ? 2 : 1);
  if (p >= data.length) return null;
  return { picType, blob: new Blob([data.slice(p)], { type: mime }) };
}

export async function readTags(file) {
  const out = {};
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
      const ver = head[3];
      const flags = head[5];
      const size = synchsafe(head, 6);
      const buf = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
      let p = 0;
      if (flags & 0x40 && ver >= 3) p = ver === 4 ? synchsafe(buf, 0) : be32(buf, 0) + 4;
      const v22 = ver === 2;
      const idLen = v22 ? 3 : 4;
      const hdrLen = v22 ? 6 : 10;
      let bestPic = null;
      while (p + hdrLen <= buf.length) {
        const id = String.fromCharCode(...buf.subarray(p, p + idLen));
        if (!/^[A-Z0-9]+$/.test(id)) break;
        const fsize = v22
          ? (buf[p + 3] << 16) | (buf[p + 4] << 8) | buf[p + 5]
          : ver === 4 ? synchsafe(buf, p + 4) : be32(buf, p + 4);
        if (fsize <= 0) break;
        const data = buf.subarray(p + hdrLen, p + hdrLen + fsize);
        p += hdrLen + fsize;
        switch (id) {
          case 'TIT2': case 'TT2': out.title = textFrame(data); break;
          case 'TPE1': case 'TP1': out.artist = textFrame(data); break;
          case 'TPE2': case 'TP2': out.albumArtist = textFrame(data); break;
          case 'TALB': case 'TAL': out.album = textFrame(data); break;
          case 'TYER': case 'TYE': case 'TDRC': out.year = (textFrame(data).match(/\d{4}/) || [])[0]; break;
          case 'TRCK': case 'TRK': out.trackNo = parseInt(textFrame(data), 10) || undefined; break;
          case 'TCON': case 'TCO': out.genre = textFrame(data).replace(/^\(\d+\)/, '') || undefined; break;
          case 'APIC': case 'PIC': {
            const pic = pictureFrame(data, v22);
            // Prefer the front cover (type 3); otherwise keep the first picture.
            if (pic && (!bestPic || pic.picType === 3)) bestPic = pic;
            break;
          }
        }
      }
      if (bestPic) out.cover = bestPic.blob;
    }
  } catch (e) {
    console.warn('Tags konnten nicht gelesen werden:', file.name, e);
  }

  const base = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  if (!out.title || !out.artist) {
    const m = base.match(/^(?:\d+[\s.\-]+)?(.+?)\s+-\s+(.+)$/);
    if (m) {
      out.artist ||= m[1].trim();
      out.title ||= m[2].trim();
    }
  }
  out.title ||= base || 'Unbekannter Titel';
  out.artist ||= 'Unbekannter Künstler';
  out.album ||= 'Unbekanntes Album';
  return out;
}

export function readDuration(blob) {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    const url = URL.createObjectURL(blob);
    const done = (v) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      a.removeAttribute('src');
      resolve(v);
    };
    const timer = setTimeout(() => done(0), 8000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(-1); // -1 = this browser can't decode the file
    a.src = url;
  });
}
