/* Frequently Asked Questions: ET's own script for this section, as it runs on the live page. It runs once for each copy of the section;
   document and window below are scoped to that copy by et-runtime.js (querySelector, getElementById, DOMContentLoaded …). */
RevampSections.register("faq", function (section, document, window) {
    document.addEventListener("DOMContentLoaded", function () {
    const faqSection = document.querySelector("#frequently-asked-questions");
    if (!faqSection) return;
    const faqItems = faqSection.querySelectorAll(".faq-item");
    function closeItem(item) {
      const question = item.querySelector(".faq-question");
      item.classList.remove("active");
      question.setAttribute("aria-expanded", "false");
    }
    function openItem(item) {
      const question = item.querySelector(".faq-question");
      item.classList.add("active");
      question.setAttribute("aria-expanded", "true");
    }
    faqItems.forEach(function (item) {
      item.addEventListener("click", function (event) {
        if (event.target.closest(".faq-answer-wrap")) return;
        const isActive = item.classList.contains("active");
        faqItems.forEach(function (otherItem) {
          if (otherItem !== item) closeItem(otherItem);
        });
        if (isActive) {
          closeItem(item);
        } else {
          openItem(item);
        }
      });
    });
  });
});
