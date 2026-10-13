/* Is this IP address one on the public internet?

   The single test behind every outbound request this product makes to an address a user supplied. It has
   no dependencies beyond node:net so that the separately deployed lovable-scraper-service can carry an
   identical copy. Anything that is not plainly a public unicast address is refused: loopback, private and
   carrier-grade NAT ranges, link-local (which includes the cloud metadata service at 169.254.169.254),
   documentation, benchmarking, multicast and reserved space — and the IPv6 forms that carry an IPv4
   address inside them (IPv4-mapped, IPv4-compatible, NAT64, 6to4), which are tested as that IPv4 address. */

const net = require('net');

var V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
];
var V6_BLOCKED = [
  ['::', 128], ['::1', 128], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
];

var blockList = new net.BlockList();
V4_BLOCKED.forEach(function (r) { blockList.addSubnet(r[0], r[1], 'ipv4'); });
V6_BLOCKED.forEach(function (r) { blockList.addSubnet(r[0], r[1], 'ipv6'); });

/* "2001:db8::1" -> its 16 bytes, or null. Accepts a trailing dotted IPv4 ("::ffff:10.0.0.1"). */
function ipv6Bytes(ip) {
  var text = String(ip).replace(/%.*$/, '');
  var tail = null, m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (m) {
    if (net.isIP(m[2]) !== 4) return null;
    tail = m[2].split('.').map(Number);
    text = m[1] + '0:0';
  }
  var halves = text.split('::');
  if (halves.length > 2) return null;
  var head = halves[0] ? halves[0].split(':') : [];
  var rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  var groups;
  if (rest === null) groups = head;
  else {
    var missing = 8 - head.length - rest.length;
    if (missing < 0) return null;
    groups = head.concat(new Array(missing).fill('0'), rest);
  }
  if (groups.length !== 8) return null;
  var bytes = [];
  for (var i = 0; i < 8; i++) {
    if (!/^[0-9a-f]{1,4}$/i.test(groups[i])) return null;
    var n = parseInt(groups[i], 16);
    bytes.push(n >> 8, n & 255);
  }
  if (tail) { bytes[12] = tail[0]; bytes[13] = tail[1]; bytes[14] = tail[2]; bytes[15] = tail[3]; }
  return bytes;
}

/* The IPv4 address an IPv6 address stands for, or "" when it stands for none. */
function embeddedIpv4(bytes) {
  function zero(from, to) { for (var i = from; i < to; i++) if (bytes[i] !== 0) return false; return true; }
  var v4 = bytes.slice(12).join('.');
  if (zero(0, 10) && bytes[10] === 255 && bytes[11] === 255) return v4;                 // ::ffff:a.b.c.d
  if (zero(0, 12)) return v4;                                                            // ::a.b.c.d (and ::, ::1)
  if (bytes[0] === 0 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && zero(4, 12)) return v4;   // 64:ff9b::/96
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return bytes.slice(2, 6).join('.');        // 2002:AABB:CCDD::/48
  return '';
}

function isPublicAddress(ip) {
  var text = String(ip == null ? '' : ip).trim().replace(/^\[|\]$/g, '');
  var family = net.isIP(text.replace(/%.*$/, ''));
  if (family === 4) return !blockList.check(text, 'ipv4');
  if (family !== 6) return false;
  var bytes = ipv6Bytes(text);
  if (!bytes) return false;
  var inner = embeddedIpv4(bytes);
  if (inner) return !blockList.check(inner, 'ipv4');
  return !blockList.check(text.replace(/%.*$/, ''), 'ipv6');
}

/* Names that never mean a public site, whatever they resolve to. */
function isInternalHostname(hostname) {
  var host = String(hostname == null ? '' : hostname).toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host === 'metadata' || host === 'ip6-localhost' || host === 'ip6-loopback') return true;
  return /\.(?:localhost|local|internal|lan|home|corp|intranet|localdomain)$/.test(host);
}

module.exports = { isPublicAddress, isInternalHostname };
