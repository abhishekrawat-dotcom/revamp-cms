/* FAQ accordion — same behaviour as templates/tech500's faq/script.js (one item open at a time, a click inside
   an open answer doesn't close it), adapted to this design's own classes (.accordion-bx / h3.accordion / .panel
   instead of .faq-item / .faq-question / .faq-answer-wrap). Runs per section so a duplicated FAQ gets an
   accordion of its own, and listens on the section rather than each item so questions added in the editor
   open and close too. */
RevampSections.register('faq', function (section) {
  function setOpen(item, open) {
    item.classList.toggle('active', open);
  }

  section.addEventListener('click', function (event) {
    var item = event.target.closest('.accordion-bx');
    if (!item || !section.contains(item) || event.target.closest('.panel')) return;
    var isActive = item.classList.contains('active');
    section.querySelectorAll('.accordion-bx').forEach(function (other) { if (other !== item) setOpen(other, false); });
    setOpen(item, !isActive);
  });
});
