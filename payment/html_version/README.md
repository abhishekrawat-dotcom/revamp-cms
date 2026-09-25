# SaaS Payment Dashboard Prototype

A high-fidelity, interactive B2B dashboard prototype designed for event management, ticketing, and payment tracking. This project showcases complex UI/UX patterns, dynamic state management, and real-world business logic built entirely with Vanilla JavaScript, HTML, and CSS.

### 🌐 [View Live Prototype](https://rohitrmishra.github.io/payment-prototype/)

---

## ✨ Key Features

### 📊 Interactive HUD Bar & Data Filtering
- A clean, 5-metric top HUD strip (Pages, Transactions, Gross Revenue, Pending, Failed).
- Interactive routing: Clicking on specific metrics (e.g., "Failed") seamlessly navigates the user to the Transactions tab and auto-applies the relevant data filters.

### 👁️ Live Checkout Preview Modal
- A dynamic "Preview Page" action that triggers a dedicated modal displaying a highly accurate, buyer-facing checkout card.
- Allows organizers to instantly visualize what their attendees will see before publishing the page.

### 🏷️ Smart Auto-Coupons
- Automated discount code logic that calculates new pricing on the fly.
- The live preview instantly strikes through the original price, displays the discounted price, and auto-generates descriptive, editable text for the discount (e.g., "20% off applied automatically").

### ✉️ Streamlined Invoicing & Mail Actions
- Standardized, consistent table layouts for Tax Invoices, Invoice Listings, and Credit Notes.
- Integrated quick-action "Mail" buttons to simulate one-click email delivery of financial documents to clients.
- Cleanly formatted base pricing with "+ 18% GST" explicitly separated for enterprise clarity.

---

## 🛠️ Built With
- **HTML5 & Vanilla CSS:** Custom design system without heavy CSS frameworks, ensuring maximum flexibility and performance.
- **Vanilla JavaScript (ES6):** No frontend frameworks (React/Vue). All state management, routing, and DOM manipulation are handled natively.
- **Inter Font & Tabler Icons:** Clean, modern typography and iconography designed for data-heavy SaaS interfaces.

---

## 🚀 How to Run Locally

Since this project has no build tools or node dependencies, it is incredibly easy to run locally:

1. Clone the repository:
   ```bash
   git clone https://github.com/rohitrmishra/payment-prototype.git
   ```
2. Open `index.html` directly in your favorite browser, or use a local server like VS Code Live Server.

---

*Designed and developed by Rohit Mishra.*
