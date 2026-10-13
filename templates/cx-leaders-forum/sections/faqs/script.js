/* FAQ accordion: one question open at a time (et-runtime.js, RevampSections.accordion). */
RevampSections.register('faqs', function (section) {
  RevampSections.accordion(section, { item: '.faq-item', trigger: '.faq-question', panel: '.faq-answer-wrap' });
});
