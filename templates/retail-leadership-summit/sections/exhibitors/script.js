/* Exhibitor-category accordion — same open/close behaviour as the FAQ accordion (templates/tech500's
   faq/script.js and this template's own faq/script.js), just targeting this section's own class names
   (.accordion-bx / h3.accordion / .panel) since the live page reused the FAQ widget's CSS for an unrelated
   list of exhibitor categories. Runs per section so a duplicated section gets an accordion of its own. */
RevampSections.register('exhibitors', function (section) {
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
