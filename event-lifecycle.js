/* event-lifecycle.js — where an event sits: Draft, Upcoming, Active, Completed, Cancelled or Deleted.

   One rule for the whole of Oneworld 2.0, so the events dashboard's tabs and what ETB2B AI says about an event
   give the same answer (the server reading the clock in India, as "Time zones" below says). The dashboard (Event_Listing.html) loads this file and reads window.RevampLifecycle; the
   server (functions/lib/dash-bot.js) requires it. It was the dashboard's own lifecycleOf() until the bot needed
   the same answer on the server.

     RevampLifecycle.of(ev, nowMs[, opts])  -> 'deleted' | 'cancelled' | 'draft' | 'upcoming' | 'active' | 'completed'
     RevampLifecycle.LABELS                 -> the word each of those is shown as

   The record's own `status` says "draft" from the day the event is made and nothing moves it on, so the answer is
   worked out from what is true of the event: a site that is not live is a Draft; a live one is Upcoming until it
   starts, Active while it runs and Completed once it has ended (an event with no end runs to the end of the day it
   starts; one with no date yet is Upcoming). Cancelled and deleted events stay where they were put.

   Time zones. Create Event saves its dates as the date picker gives them, a wall-clock time with no zone
   ('2026-11-20T19:00'), and "the end of the day it starts" is a day on some clock too. Without opts both are read
   in the time zone of whoever runs this: in a browser that is the person's own zone, exactly as the dashboard has
   always shown it. A server runs in UTC, where a 7 pm awards night in India would start at 00:30 the next
   morning and its day would end at 05:29, so the server passes opts.tzOffsetMin (330 for India) and gets the
   answer the dashboard gives in that offset:
     - a date-and-time with no zone ('YYYY-MM-DDTHH:mm', with optional seconds and fraction) is that clock time in
       the offset, for the start and the end alike (a value the browser refuses is refused here too);
     - a date alone ('YYYY-MM-DD') is UTC midnight, as every browser reads it;
     - a stamp that names its zone ('Z', '+05:30') and a number of milliseconds are the instant they name;
     - an event with no end runs to the end of the offset's day it starts on.
   An offset that is not a finite number is no offset.

   ES5 on purpose (var, function, no arrows): the dashboard serves it as it is, with no build step. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.RevampLifecycle = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* frozen: the page and every server request share this one object, and a caller that changed a word would
     change it for all of them */
  var LABELS = Object.freeze({ draft: 'Draft', upcoming: 'Upcoming', active: 'Active', completed: 'Completed', cancelled: 'Cancelled', deleted: 'Deleted' });

  /* a date-and-time with no zone: what <input type="datetime-local"> gives, with optional seconds and fraction */
  var ZONELESS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

  /* opts.tzOffsetMin in milliseconds, or null when there is no usable offset (then local time, as before) */
  function offsetMs(opts) {
    return opts && typeof opts.tzOffsetMin === 'number' && isFinite(opts.tzOffsetMin) ? opts.tzOffsetMin * 60000 : null;
  }

  /* a start or an end as milliseconds (NaN when there is none or it is not a date). With an offset, a zone-less
     date-and-time is that clock time in the offset: the same text read as UTC by the engine's own date parser (so
     it rolls over or is refused exactly as the browser's local reading of it), less the offset. Everything else,
     and everything without an offset, is new Date(v), as the dashboard has always read it. */
  function instant(v, off) {
    if (!v) return NaN;
    if (off !== null && typeof v === 'string' && ZONELESS.test(v)) {
      var utc = Date.parse(v + 'Z');
      return isNaN(utc) ? NaN : utc - off;
    }
    return new Date(v).getTime();
  }

  /* the last millisecond of the day `start` falls on: in local time, or in the UTC offset `off` (ms) */
  function endOfStartDay(start, off) {
    if (off === null) { var d = new Date(start); d.setHours(23, 59, 59, 999); return d.getTime(); }
    /* shift into the offset, take that day's end on the UTC clock, shift back */
    var t = new Date(start + off);
    t.setUTCHours(23, 59, 59, 999);
    return t.getTime() - off;
  }

  function of(ev, now, opts) {
    if (ev.deletedAt || ev.status === 'deleted') return 'deleted';
    if (ev.status === 'cancelled') return 'cancelled';
    if (ev.published !== true) return 'draft';
    var off = offsetMs(opts);
    var start = instant(ev.start, off);
    var end = instant(ev.end, off);
    if (isNaN(start) && isNaN(end)) return 'upcoming';
    if (isNaN(end)) end = endOfStartDay(start, off);
    if (end < now) return 'completed';
    if (isNaN(start) || start <= now) return 'active';
    return 'upcoming';
  }

  return { of: of, LABELS: LABELS };
});
