// What a video file really is, read from its own bytes — never from its name or the type a browser declared.
// Used by lib/api-hero-video.js on a banner video the moment it has been uploaded, before it is made public.
//
//   probe(read, size) -> Promise<{ type, container, duration, width, height, codec, hasAudio, fastStart }>
//     read(start, end) -> Promise<Buffer>   bytes start..end inclusive (a ranged read of the stored object)
//     size                                  the object's length in bytes
//   Rejects with an Error whose `reason` says why the file cannot be used and whose message a person can read:
//     'not-video'   not an MP4 or WebM file at all (a picture, a document, a renamed file)
//     'quicktime'   a QuickTime .mov (Chrome and Firefox do not play every one)
//     'codec'       a picture format browsers do not all play (HEVC / H.265, MPEG-4 Part 2, H.263)
//     'no-video'    no picture track
//     'unreadable'  the file is cut short or damaged, so its length cannot be read
//
// Only the parts that matter are read: an MP4's box headers and its `moov` box (the index, usually tens of KB,
// at most a few MB), a WebM's first 512 KB (its header, Info and Tracks come before any picture data).
// Nothing here decodes a picture.
'use strict';

var MAX_MOOV = 8 * 1024 * 1024;
var MAX_WHOLE = 40 * 1024 * 1024;     // a fragmented file is read whole to add up its length: never anything larger

function fail(reason, message) { return Object.assign(new Error(message), { reason: reason }); }

var MESSAGES = {
  'not-video': 'This file is not a video we can use. Upload an MP4 (H.264) or a WebM file.',
  quicktime: 'This is a QuickTime (.mov) file, which not every browser plays. Export it as MP4 (H.264) and upload that.',
  codec: 'This video is in a format (such as HEVC / H.265) that many browsers cannot play. Export it as MP4 with H.264 and upload that.',
  'no-video': 'This file has no picture in it. Upload a video file.',
  unreadable: 'This video file seems to be damaged or cut short, so its length cannot be read. Export it again and upload the new file.'
};
function refuse(reason) { return fail(reason, MESSAGES[reason]); }

/* ---------- MP4 (ISO base media) ---------- */
var PLAYABLE = { avc1: 'H.264', avc3: 'H.264', av01: 'AV1', vp09: 'VP9' };
var REFUSED = { hvc1: 1, hev1: 1, dvh1: 1, dvhe: 1, mp4v: 1, s263: 1 };

function boxHeader(buf, at, fileEnd) {
  if (at + 8 > buf.length) return null;
  var size = buf.readUInt32BE(at), type = buf.toString('latin1', at + 4, at + 8), head = 8;
  if (size === 1) {
    if (at + 16 > buf.length) return null;
    size = buf.readUInt32BE(at + 8) * 4294967296 + buf.readUInt32BE(at + 12);
    head = 16;
  } else if (size === 0) {
    size = fileEnd - at;
  }
  return { type: type, size: size, head: head };
}

/* the children of a box held in `buf` from `start` to `end` */
function children(buf, start, end) {
  var out = [], at = start;
  while (at + 8 <= end) {
    var h = boxHeader(buf, at, end);
    if (!h || h.size < h.head || at + h.size > end) break;
    out.push({ type: h.type, start: at + h.head, end: at + h.size });
    at += h.size;
  }
  return out;
}
function child(buf, box, type) {
  var list = children(buf, box.start, box.end);
  for (var i = 0; i < list.length; i++) if (list[i].type === type) return list[i];
  return null;
}

function readMoov(moov) {
  var root = { start: 0, end: moov.length };
  var out = { duration: 0, width: 0, height: 0, codec: '', hasAudio: false, hasVideo: false, refused: '' };
  var mvhd = child(moov, root, 'mvhd');
  if (mvhd && mvhd.end - mvhd.start >= 20) {
    var v = moov[mvhd.start], scale, dur;
    if (v === 1 && mvhd.end - mvhd.start >= 32) { scale = moov.readUInt32BE(mvhd.start + 20); dur = moov.readUInt32BE(mvhd.start + 24) * 4294967296 + moov.readUInt32BE(mvhd.start + 28); }
    else { scale = moov.readUInt32BE(mvhd.start + 12); dur = moov.readUInt32BE(mvhd.start + 16); }
    if (scale > 0 && dur > 0 && dur !== 0xFFFFFFFF) out.duration = dur / scale;
    /* a fragmented file says how long it is in mvex › mehd instead */
    if (!out.duration && scale > 0) {
      var mvex = child(moov, root, 'mvex'), mehd = mvex && child(moov, mvex, 'mehd');
      if (mehd) {
        var fd = moov[mehd.start] === 1 ? moov.readUInt32BE(mehd.start + 4) * 4294967296 + moov.readUInt32BE(mehd.start + 8) : moov.readUInt32BE(mehd.start + 4);
        if (fd > 0) out.duration = fd / scale;
      }
    }
  }
  children(moov, root.start, root.end).filter(function (b) { return b.type === 'trak'; }).forEach(function (trak) {
    var mdia = child(moov, trak, 'mdia'), hdlr = mdia && child(moov, mdia, 'hdlr');
    var kind = hdlr && hdlr.end - hdlr.start >= 12 ? moov.toString('latin1', hdlr.start + 8, hdlr.start + 12) : '';
    if (kind === 'soun') { out.hasAudio = true; return; }
    if (kind !== 'vide') return;
    var minf = child(moov, mdia, 'minf'), stbl = minf && child(moov, minf, 'stbl'), stsd = stbl && child(moov, stbl, 'stsd');
    var codec = stsd && stsd.end - stsd.start >= 16 ? moov.toString('latin1', stsd.start + 12, stsd.start + 16) : '';
    if (REFUSED[codec]) { out.refused = codec; return; }
    out.hasVideo = true;
    if (!out.codec) out.codec = PLAYABLE[codec] || codec;
    var tkhd = child(moov, trak, 'tkhd');
    /* for a fragmented file: which track is the picture, and its own clock */
    if (tkhd && !out.trackId) out.trackId = moov.readUInt32BE(tkhd.start + (moov[tkhd.start] === 1 ? 20 : 12));
    var mdhd = child(moov, mdia, 'mdhd');
    if (mdhd && !out.trackScale) out.trackScale = moov.readUInt32BE(mdhd.start + (moov[mdhd.start] === 1 ? 20 : 12));
    if (tkhd && !out.width) {
      var off = moov[tkhd.start] === 1 ? 88 : 76;
      if (tkhd.start + off + 8 <= tkhd.end) {
        out.width = Math.round(moov.readUInt32BE(tkhd.start + off) / 65536);
        out.height = Math.round(moov.readUInt32BE(tkhd.start + off + 4) / 65536);
      }
    }
  });
  /* a fragmented file's default sample length for that track (mvex › trex), for fragments that do not say */
  var mvex2 = child(moov, root, 'mvex');
  if (mvex2) {
    out.fragmented = true;
    children(moov, mvex2.start, mvex2.end).forEach(function (b) {
      if (b.type === 'trex' && b.end - b.start >= 16 && moov.readUInt32BE(b.start + 4) === out.trackId) out.trexDuration = moov.readUInt32BE(b.start + 12);
    });
  }
  return out;
}

/* A fragmented MP4 (what a browser's own recorder makes) whose index gives no length: the length of its
   picture track, added up from every fragment's sample table (moof › traf › tfhd / trun). `buf` is the file. */
function fragmentedDuration(buf, info) {
  var total = 0;
  children(buf, 0, buf.length).forEach(function (moof) {
    if (moof.type !== 'moof') return;
    children(buf, moof.start, moof.end).forEach(function (traf) {
      if (traf.type !== 'traf') return;
      var tfhd = child(buf, traf, 'tfhd');
      if (!tfhd || buf.readUInt32BE(tfhd.start + 4) !== info.trackId) return;
      var flags = buf.readUInt32BE(tfhd.start) & 0xFFFFFF, at = tfhd.start + 8, fallback = info.trexDuration || 0;
      if (flags & 0x01) at += 8;
      if (flags & 0x02) at += 4;
      if (flags & 0x08) fallback = buf.readUInt32BE(at);
      children(buf, traf.start, traf.end).forEach(function (trun) {
        if (trun.type !== 'trun') return;
        var tf = buf.readUInt32BE(trun.start) & 0xFFFFFF, count = buf.readUInt32BE(trun.start + 4), p = trun.start + 8;
        if (tf & 0x01) p += 4;
        if (tf & 0x04) p += 4;
        var each = ((tf & 0x100) ? 4 : 0) + ((tf & 0x200) ? 4 : 0) + ((tf & 0x400) ? 4 : 0) + ((tf & 0x800) ? 4 : 0);
        for (var i = 0; i < count && p + each <= trun.end; i++, p += each) total += (tf & 0x100) ? buf.readUInt32BE(p) : fallback;
      });
    });
  });
  return info.trackScale > 0 ? total / info.trackScale : 0;
}

function probeMp4(read, size, head) {
  var ftyp = boxHeader(head, 0, size);
  var brand = head.toString('latin1', 8, 12);
  if (brand === 'qt  ') return Promise.reject(refuse('quicktime'));
  var boxes = [];
  /* the top-level boxes, header by header (each a small read unless it is already in `head`) */
  function walk(at, n) {
    if (at >= size || n > 200) return Promise.resolve();
    var have = at + 16 <= head.length ? Promise.resolve(head.slice(at, at + 16)) : read(at, Math.min(size - 1, at + 15));
    return have.then(function (b) {
      var h = boxHeader(b, 0, size - at);
      if (!h || h.size < h.head) return;
      boxes.push({ type: h.type, at: at, size: h.size, head: h.head });
      if (h.type === 'moov') return;           // everything needed is in it
      return walk(at + h.size, n + 1);
    });
  }
  return walk(ftyp.size, 0).then(function () {
    var moov = boxes.filter(function (b) { return b.type === 'moov'; })[0];
    var mdat = boxes.filter(function (b) { return b.type === 'mdat' || b.type === 'moof'; })[0];
    if (!moov) throw refuse('unreadable');
    if (moov.size > MAX_MOOV || moov.at + moov.size > size) throw refuse('unreadable');
    return read(moov.at + moov.head, moov.at + moov.size - 1).then(function (body) {
      var info = readMoov(body);
      if (info.refused && !info.hasVideo) throw refuse('codec');
      if (!info.hasVideo) throw refuse('no-video');
      if (info.duration > 0 || !info.fragmented || size > MAX_WHOLE) return info;
      /* the length is only in the fragments: the file is read whole (the caller has already capped its size) */
      return read(0, size - 1).then(function (all) { info.duration = fragmentedDuration(all, info); return info; });
    }).then(function (info) {
      if (!(info.duration > 0)) throw refuse('unreadable');
      return {
        type: 'video/mp4', container: 'MP4', duration: Math.round(info.duration * 100) / 100, width: info.width, height: info.height,
        codec: info.codec, hasAudio: info.hasAudio,
        /* the index before the picture data: a browser can start playing before the whole file is in */
        fastStart: !mdat || moov.at < mdat.at
      };
    });
  });
}

/* ---------- WebM (Matroska) ---------- */
var EBML = { Segment: 0x18538067, Info: 0x1549A966, Tracks: 0x1654AE6B, TrackEntry: 0xAE, TrackType: 0x83, CodecID: 0x86,
  Video: 0xE0, PixelWidth: 0xB0, PixelHeight: 0xBA, TimecodeScale: 0x2AD7B1, Duration: 0x4489, DocType: 0x4282, Cluster: 0x1F43B675 };

/* an element ID keeps its length marker; a size does not. -> { value, len } or null */
function vint(buf, at, keepMarker) {
  if (at >= buf.length) return null;
  var first = buf[at], len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8 || at + len > buf.length) return null;
  var value = keepMarker ? first : (first & (mask - 1)), unknown = (first & (mask - 1)) === mask - 1;
  for (var i = 1; i < len; i++) { value = value * 256 + buf[at + i]; if (buf[at + i] !== 0xFF) unknown = false; }
  return { value: value, len: len, unknown: !keepMarker && unknown };
}
function elements(buf, start, end) {
  var out = [], at = start;
  while (at < end) {
    var id = vint(buf, at, true); if (!id) break;
    var sz = vint(buf, at + id.len, false); if (!sz) break;
    var dataAt = at + id.len + sz.len, dataEnd = sz.unknown ? end : Math.min(end, dataAt + sz.value);
    out.push({ id: id.value, start: dataAt, end: dataEnd, cut: !sz.unknown && dataAt + sz.value > end });
    if (sz.unknown) break;
    at = dataAt + sz.value;
  }
  return out;
}
function uint(buf, el) { var v = 0; for (var i = el.start; i < el.end; i++) v = v * 256 + buf[i]; return v; }
function float(buf, el) { return el.end - el.start === 4 ? buf.readFloatBE(el.start) : el.end - el.start === 8 ? buf.readDoubleBE(el.start) : 0; }

function probeWebm(read, size) {
  return read(0, Math.min(size, 512 * 1024) - 1).then(function (buf) {
    var top = elements(buf, 0, buf.length);
    var header = top[0];
    var doctype = header && elements(buf, header.start, header.end).filter(function (e) { return e.id === EBML.DocType; })[0];
    if (!doctype || buf.toString('latin1', doctype.start, doctype.end).replace(/\0+$/, '') !== 'webm') throw refuse('not-video');
    var segment = top.filter(function (e) { return e.id === EBML.Segment; })[0];
    if (!segment) throw refuse('unreadable');
    var info = { duration: 0, width: 0, height: 0, codec: '', hasAudio: false, hasVideo: false };
    var scale = 1000000;
    elements(buf, segment.start, segment.end).forEach(function (el) {
      if (el.id === EBML.Info) {
        var dur = 0;
        elements(buf, el.start, el.end).forEach(function (x) {
          if (x.id === EBML.TimecodeScale) scale = uint(buf, x) || scale;
          if (x.id === EBML.Duration) dur = float(buf, x);
        });
        info.rawDuration = dur;
      }
      if (el.id === EBML.Tracks) {
        elements(buf, el.start, el.end).filter(function (x) { return x.id === EBML.TrackEntry; }).forEach(function (t) {
          var kind = 0, codec = '', w = 0, h = 0;
          elements(buf, t.start, t.end).forEach(function (x) {
            if (x.id === EBML.TrackType) kind = uint(buf, x);
            if (x.id === EBML.CodecID) codec = buf.toString('latin1', x.start, x.end).replace(/\0+$/, '');
            if (x.id === EBML.Video) elements(buf, x.start, x.end).forEach(function (y) {
              if (y.id === EBML.PixelWidth) w = uint(buf, y);
              if (y.id === EBML.PixelHeight) h = uint(buf, y);
            });
          });
          if (kind === 2) info.hasAudio = true;
          if (kind === 1) {
            info.hasVideo = true;
            if (!info.codec) { info.codec = { V_VP8: 'VP8', V_VP9: 'VP9', V_AV1: 'AV1' }[codec] || codec; info.width = w; info.height = h; }
          }
        });
      }
    });
    if (!info.hasVideo) throw refuse('no-video');
    info.duration = info.rawDuration > 0 ? info.rawDuration * scale / 1e9 : 0;
    if (!(info.duration > 0)) throw refuse('unreadable');
    return { type: 'video/webm', container: 'WebM', duration: Math.round(info.duration * 100) / 100, width: info.width, height: info.height,
      codec: info.codec, hasAudio: info.hasAudio, fastStart: true };
  });
}

function probe(read, size) {
  if (!(size > 16)) return Promise.reject(refuse('not-video'));
  return read(0, Math.min(size, 65536) - 1).then(function (head) {
    if (head.length >= 12 && head.toString('latin1', 4, 8) === 'ftyp') return probeMp4(read, size, head);
    if (head.length >= 4 && head.readUInt32BE(0) === 0x1A45DFA3) return probeWebm(read, size);
    throw refuse('not-video');
  });
}

module.exports = { probe: probe, MESSAGES: MESSAGES };
